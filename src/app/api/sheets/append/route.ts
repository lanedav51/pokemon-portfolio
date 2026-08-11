import { NextRequest, NextResponse } from "next/server";
import { appendCard, DEFAULT_SHEET_NAME } from "@/lib/googleSheets";
import type { AddCardPayload } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as AddCardPayload;

    if (!payload.cardName || !payload.setName || !payload.condition) {
      return NextResponse.json({ error: "Missing required card fields" }, { status: 400 });
    }

    const sheetName = payload.sheetName?.trim() || DEFAULT_SHEET_NAME;
    await appendCard(payload, sheetName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Append to sheet failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Append to sheet failed" },
      { status: 500 }
    );
  }
}
