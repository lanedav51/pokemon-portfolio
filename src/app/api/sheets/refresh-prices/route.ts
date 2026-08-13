import { NextRequest, NextResponse } from "next/server";
import { getCardById } from "@/lib/pokemontcg";
import { bulkUpdatePrices, DEFAULT_SHEET_NAME, listPortfolio, recordHistorySnapshot } from "@/lib/googleSheets";
import { mapWithConcurrency } from "@/lib/concurrency";

export async function POST(req: NextRequest) {
  try {
    const { sheetName: rawSheetName, onlyZero } = (await req.json()) as {
      sheetName?: string;
      onlyZero?: boolean;
    };
    const sheetName = rawSheetName?.trim() || DEFAULT_SHEET_NAME;

    const entries = await listPortfolio(sheetName);
    const withCardId = entries.filter((entry) => entry.cardId && (!onlyZero || entry.price === 0));

    const lookups = await mapWithConcurrency(withCardId, 5, async (entry) => {
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

    // Recompute totals with the refreshed prices for the history snapshot,
    // instead of a second full listPortfolio round-trip.
    const priceByRow = new Map(updates.map((u) => [u.rowIndex, u.price]));
    const totalValue = entries.reduce((sum, e) => sum + (priceByRow.get(e.rowIndex) ?? e.price) * e.quantity, 0);
    const cardCount = entries.reduce((sum, e) => sum + e.quantity, 0);
    await recordHistorySnapshot(sheetName, totalValue, cardCount);

    return NextResponse.json({ updated: updates.length, total: withCardId.length, totalValue });
  } catch (err) {
    console.error("Refresh prices failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh prices failed" },
      { status: 500 }
    );
  }
}
