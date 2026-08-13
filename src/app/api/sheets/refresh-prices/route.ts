import { NextRequest, NextResponse } from "next/server";
import { getCardById } from "@/lib/pokemontcg";
import { getBackupPrice, isBackupPriceRateLimited } from "@/lib/backupPricing";
import { bulkUpdatePrices, DEFAULT_SHEET_NAME, listPortfolio, recordHistorySnapshot } from "@/lib/googleSheets";
import { mapWithConcurrency } from "@/lib/concurrency";

// A full refresh checks pokemontcg.io first (falling back to the backup
// source only on a miss, inside getCardById) since it's the fresher,
// authoritative source. A $0 entry, though, already failed that same check
// last time it ran -- re-asking pokemontcg.io is very likely to just waste
// a round trip on the same null. Fix $0 skips straight to the backup
// source instead, using the name/set/number already sitting in the sheet
// row (no pokemontcg.io call needed at all), which is both simpler and
// roughly half the outbound requests per card.
//
// Even at one call per card, a large enough zero-priced list could still
// outrun a serverless function's execution limit in one shot (a portfolio-
// wide refresh measured well past it at two calls/card), so both modes
// still process a bounded batch per request and let the client loop it to
// completion (see the Portfolio page) -- that's what actually guarantees
// no timeout regardless of portfolio size, not just doing less work.
//
// pokemontcg.io retries transient failures up to 3x with backoff (helpful
// for a single lookup, expensive to repeat across a batch) -- its worst
// case per card is several seconds, so BATCH_SIZE_FULL matches the
// concurrency level exactly (one parallel wave per request, never a
// second sequential wave within the same timeout budget). getBackupPrice
// has no retry loop and is typically fast, so Fix $0 can safely process
// more per request.
const CONCURRENCY = 5;
const BATCH_SIZE_FULL = CONCURRENCY;
const BATCH_SIZE_ZERO_ONLY = 15;

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
    const candidates = entries.filter((entry) => {
      if (excluded.has(entry.rowIndex)) return false;
      return onlyZero ? entry.price === 0 && entry.cardName && entry.setName : Boolean(entry.cardId);
    });
    const batchSize = onlyZero ? BATCH_SIZE_ZERO_ONLY : BATCH_SIZE_FULL;
    const batch = candidates.slice(0, batchSize);

    const lookups = await mapWithConcurrency(batch, CONCURRENCY, async (entry) => {
      try {
        const price = onlyZero
          ? await getBackupPrice(entry.cardName, entry.setName, entry.number)
          : ((await getCardById(entry.cardId))?.marketPrice ?? null);
        return price != null ? { rowIndex: entry.rowIndex, price, quantity: entry.quantity } : null;
      } catch (err) {
        console.error(`Price lookup failed for row ${entry.rowIndex}`, err);
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

    return NextResponse.json({
      updatedInBatch: updates.length,
      attemptedRows,
      remaining,
      totalValue,
      backupRateLimited: onlyZero && isBackupPriceRateLimited(),
    });
  } catch (err) {
    console.error("Refresh prices failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh prices failed" },
      { status: 500 }
    );
  }
}
