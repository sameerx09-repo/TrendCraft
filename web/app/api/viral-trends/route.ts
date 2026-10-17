import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq, and, desc } from "drizzle-orm";
import { withTtlCache } from "@/lib/db/ttlCache";

const CACHE_TTL_MS = 15_000;

/** Manually-sourced reels only (platform: "manual_viral") — the automated
 * scrape pipeline's items live in /api/content-library instead. See
 * lib/db/schema.ts's trend_items.readyForRemix doc comment for why this
 * exists at all. */
export async function GET() {
  const brand = await getOrCreateCurrentBrand();

  return NextResponse.json(
    await withTtlCache("viral-trends", brand.id, CACHE_TTL_MS, async () => {
      const items = await db
        .select()
        .from(trendItems)
        .where(and(eq(trendItems.brandProfileId, brand.id), eq(trendItems.platform, "manual_viral")))
        .orderBy(desc(trendItems.scrapedAt));

      return { total: items.length, items };
    })
  );
}
