import { NextRequest, NextResponse } from "next/server";
import { createSheetTab, listSheetTabs } from "@/lib/googleSheets";

export async function GET() {
  try {
    const tabs = await listSheetTabs();
    return NextResponse.json({ tabs });
  } catch (err) {
    console.error("List sheet tabs failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List sheet tabs failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: "Portfolio name is required" }, { status: 400 });
    }

    await createSheetTab(name);
    const tabs = await listSheetTabs();
    return NextResponse.json({ tabs });
  } catch (err) {
    console.error("Create sheet tab failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create sheet tab failed" },
      { status: 400 }
    );
  }
}
