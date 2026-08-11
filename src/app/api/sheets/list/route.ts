import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SHEET_NAME, listPortfolio } from "@/lib/googleSheets";

export async function GET(req: NextRequest) {
  const sheetName = req.nextUrl.searchParams.get("sheet")?.trim() || DEFAULT_SHEET_NAME;

  try {
    const entries = await listPortfolio(sheetName);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("List portfolio failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List portfolio failed" },
      { status: 500 }
    );
  }
}
