import { NextResponse } from "next/server";
import { isMockMode } from "@/lib/clients/mockMode";

/** Lets client components know whether real-spend calls are actually live
 * — the Review page's Runway-generation status message was unconditionally
 * claiming "real spend ($2-8)" even while MOCK_MODE=true, which is
 * misleading during normal free testing. */
export async function GET() {
  return NextResponse.json({ mockMode: isMockMode() });
}

/**
 * Flips MOCK_MODE for the currently-running server process — no .env.local
 * edit, no restart needed, since isMockMode() (lib/clients/mockMode.ts)
 * reads process.env.MOCK_MODE fresh on every call rather than caching it at
 * boot. This is genuinely global: every real-spend client (Apify, Runway,
 * HeyGen, every OpenRouter copy/analysis call) checks the exact same flag,
 * so flipping to live here turns all of it on at once, not just whichever
 * feature you were looking at. Resets to whatever .env.local says on the
 * next real server restart — this only affects the current process's
 * lifetime, it doesn't persist.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.mockMode !== "boolean") {
    return NextResponse.json({ error: "expected { mockMode: boolean }" }, { status: 400 });
  }
  process.env.MOCK_MODE = body.mockMode ? "true" : "false";
  return NextResponse.json({ mockMode: isMockMode() });
}
