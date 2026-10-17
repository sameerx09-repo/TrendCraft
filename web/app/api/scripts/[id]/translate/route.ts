import { NextRequest, NextResponse } from "next/server";
import { translateToHinglish } from "@/lib/clients/hinglishTranslator";

/** Pure transform, no persistence — the edit modal's language toggle calls
 * this to preview Hinglish live; Save (PATCH /api/scripts/[id]) persists
 * whatever text is on screen at that point, English or Hinglish either
 * way, so this endpoint doesn't need to know or care which one wins. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.some((l) => typeof l !== "string")) {
    return NextResponse.json({ error: "lines must be a string[]" }, { status: 400 });
  }
  try {
    const translated = await translateToHinglish(lines);
    return NextResponse.json({ lines: translated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "translation failed" }, { status: 500 });
  }
}
