import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";

/**
 * The real "Refresh trends" trigger — replaces /api/dev/seed's hardcoded
 * hashtag list. Reads hashtags from the brand's own row (real source of
 * truth), fires the Inngest event, returns immediately (the scrape runs
 * async in scrapeTrendsForBrand — see lib/inngest/functions.ts). On-demand
 * only, per needs_deep_dive.md A2 — no scheduling/cron here.
 */
export async function POST() {
  const brand = await getOrCreateCurrentBrand();
  const hashtags = brand.hashtags ?? [];

  if (hashtags.length === 0) {
    return NextResponse.json(
      { error: "brand_profiles.hashtags is empty — nothing to scrape" },
      { status: 400 }
    );
  }

  await inngest.send([
    {
      name: "trends/scrape.requested",
      data: { brandProfileId: brand.id, brandName: brand.name, hashtags, resultsLimit: 10 },
    },
    {
      name: "trends/youtube-scrape.requested",
      data: { brandProfileId: brand.id, brandName: brand.name },
    },
    {
      // Cross-niche discovery. Deliberately carries no brand hashtags — it
      // uses the measured DISCOVERY_KEYWORDS default (advice/hack family),
      // since the whole point is sourcing viral formats from outside the
      // brand's niche. See CROSS_NICHE_DISCOVERY.md.
      name: "trends/discover.requested",
      data: { brandProfileId: brand.id, brandName: brand.name, resultsLimit: 40 },
    },
  ]);

  return NextResponse.json(
    { accepted: true, brandProfileId: brand.id, hashtags, discovery: "popular" },
    { status: 202 }
  );
}
