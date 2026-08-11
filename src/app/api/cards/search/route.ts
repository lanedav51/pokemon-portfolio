import { NextRequest, NextResponse } from "next/server";
import { searchCards } from "@/lib/pokemontcg";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const number = req.nextUrl.searchParams.get("number") ?? undefined;

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchCards(query, number);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("Card search failed", err);
    return NextResponse.json(
      { error: "The card database is temporarily unavailable. Please try searching again." },
      { status: 502 }
    );
  }
}
