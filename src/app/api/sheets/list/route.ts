import { NextResponse } from "next/server";
import { listPortfolio } from "@/lib/googleSheets";

export async function GET() {
  try {
    const entries = await listPortfolio();
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("List portfolio failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List portfolio failed" },
      { status: 500 }
    );
  }
}
