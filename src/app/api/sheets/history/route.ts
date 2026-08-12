import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SHEET_NAME, getHistory } from "@/lib/googleSheets";

export async function GET(req: NextRequest) {
  const sheetName = req.nextUrl.searchParams.get("sheet")?.trim() || DEFAULT_SHEET_NAME;

  try {
    const history = await getHistory(sheetName);
    return NextResponse.json({ history });
  } catch (err) {
    console.error("Get history failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Get history failed" },
      { status: 500 }
    );
  }
}
