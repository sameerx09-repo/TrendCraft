import { NextResponse } from "next/server";
import { scrapeInstagramReels } from "@/lib/clients/apify";

/**
 * One-time deliberate real-API smoke test (see phase1_phase2_build_tasklist.md
 * "don't burn API calls" strategy) — small hashtag list, small resultsLimit,
 * to confirm the real instagram-hashtag-scraper integration actually works
 * before building real Phase 1 logic on top of it. Not a real feature.
 */
export async function POST() {
  const items = await scrapeInstagramReels(["skincareindia"], 5);
  return NextResponse.json({
    count: items.length,
    sample: items[0],
  });
}
