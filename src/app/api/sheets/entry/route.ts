import { NextRequest, NextResponse } from "next/server";
import { deleteCardRow, DEFAULT_SHEET_NAME, updateCardRow } from "@/lib/googleSheets";
import type { EditableCardFields } from "@/lib/types";

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as EditableCardFields & { sheetName?: string; rowIndex?: number };
    const { rowIndex, condition, quantity, price, notes } = body;
    const sheetName = body.sheetName?.trim() || DEFAULT_SHEET_NAME;

    if (!rowIndex || !condition) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await updateCardRow(sheetName, rowIndex, { condition, quantity, price, notes });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Update entry failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update entry failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { sheetName, rowIndex } = (await req.json()) as { sheetName?: string; rowIndex?: number };
    if (!rowIndex) {
      return NextResponse.json({ error: "rowIndex is required" }, { status: 400 });
    }

    await deleteCardRow(sheetName?.trim() || DEFAULT_SHEET_NAME, rowIndex);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete entry failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete entry failed" },
      { status: 500 }
    );
  }
}
