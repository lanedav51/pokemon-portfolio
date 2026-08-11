import { NextRequest, NextResponse } from "next/server";
import { recognizeCardText } from "@/lib/vision";

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = (await req.json()) as { imageBase64?: string };

    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    const result = await recognizeCardText(imageBase64);
    return NextResponse.json(result);
  } catch (err) {
    console.error("OCR failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "OCR failed" },
      { status: 500 }
    );
  }
}
