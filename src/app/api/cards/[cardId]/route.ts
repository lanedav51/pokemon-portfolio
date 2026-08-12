import { NextRequest, NextResponse } from "next/server";
import { getCardById } from "@/lib/pokemontcg";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;

  try {
    const card = await getCardById(cardId);
    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
    return NextResponse.json({ card });
  } catch (err) {
    console.error("Card lookup failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Card lookup failed" },
      { status: 500 }
    );
  }
}
