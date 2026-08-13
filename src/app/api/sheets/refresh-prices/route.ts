import { NextRequest, NextResponse } from "next/server";
import { getCardById } from "@/lib/pokemontcg";
import { bulkUpdatePrices, DEFAULT_SHEET_NAME, listPortfolio, recordHistorySnapshot } from "@/lib/googleSheets";
import { mapWithConcurrency } from "@/lib/concurrency";

// Each card lookup can mean two outbound requests now (pokemontcg.io, then
// the backup source when the first has no price), each with their own
// retry-with-backoff. A portfolio-wide refresh across dozens of cards was
// measured taking well past a serverless function's execution limit, which
// gets killed by the platform and returns a non-JSON error page -- not
// something our own try/catch ever gets a chance to turn into a clean JSON
// error. Bounding the work per request and having the client call this
// repeatedly (see the Portfolio page) keeps every individual request fast
// regardless of portfolio size.
const BATCH_SIZE = 10;

export async function POST(req: NextRequest) {
  try {
    const {
      sheetName: rawSheetName,
      onlyZero,
      excludeRows = [],
    } = (await req.json()) as { sheetName?: string; onlyZero?: boolean; excludeRows?: number[] };
    const sheetName = rawSheetName?.trim() || DEFAULT_SHEET_NAME;
    const excluded = new Set(excludeRows);

    const entries = await listPortfolio(sheetName);
    // In onlyZero mode, a row that this run already priced drops out of
    // this filter on the very next call -- offset-based pagination would
    // silently skip whatever shifted into its old position. Excluding by
    // row index (rows this run has already attempted, success or not)
    // instead of slicing by position is correct regardless of how much the
    // "still $0" set shrinks as the run makes progress.
    const candidates = entries.filter(
      (entry) => entry.cardId && (!onlyZero || entry.price === 0) && !excluded.has(entry.rowIndex)
    );
    const batch = candidates.slice(0, BATCH_SIZE);

    const lookups = await mapWithConcurrency(batch, 5, async (entry) => {
      try {
        const card = await getCardById(entry.cardId);
        return card?.marketPrice != null
          ? { rowIndex: entry.rowIndex, price: card.marketPrice, quantity: entry.quantity }
          : null;
      } catch (err) {
        console.error(`Price lookup failed for ${entry.cardId}`, err);
        return null;
      }
    });

    const updates = lookups.filter((u): u is NonNullable<typeof u> => u !== null);
    await bulkUpdatePrices(sheetName, updates);

    const attemptedRows = batch.map((entry) => entry.rowIndex);
    const remaining = Math.max(candidates.length - batch.length, 0);

    // Only log one history point for the whole multi-batch run (on the
    // final batch), not one per batch -- this is conceptually one user
    // action, and needs every batch's prices already applied to be accurate.
    let totalValue: number | undefined;
    if (remaining <= 0) {
      const refreshed = await listPortfolio(sheetName);
      totalValue = refreshed.reduce((sum, e) => sum + e.totalValue, 0);
      const cardCount = refreshed.reduce((sum, e) => sum + e.quantity, 0);
      await recordHistorySnapshot(sheetName, totalValue, cardCount);
    }

    return NextResponse.json({ updatedInBatch: updates.length, attemptedRows, remaining, totalValue });
  } catch (err) {
    console.error("Refresh prices failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh prices failed" },
      { status: 500 }
    );
  }
}
