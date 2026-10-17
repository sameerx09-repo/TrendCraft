import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { brandProfiles, remixedScripts, products, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq, sql } from "drizzle-orm";

/** Real Brand Profile backend — until now, brand_profiles.hashtags/colors
 * could only change by editing the DB directly. This is what makes
 * "Refresh trends" actually configurable instead of hardcoded.
 *
 * Also computes three real, read-only signals the expanded Brand Profile
 * page needs — none of these are new columns, they're aggregates over data
 * that already exists:
 *  - angleCounts: how many remixed posts used each angle so far (steers
 *    the mock's "Content angles" display — real usage, not a taxonomy we
 *    maintain separately).
 *  - hashtagCoverage: for each tracked hashtag, how many trend_items in the
 *    library actually carry it — the real signal behind "thin tag"
 *    flagging. Not a live search-result count (the Apify scraper takes all
 *    hashtags in one combined call, so there's no per-hashtag API result
 *    to read) — this is what the library's own real data can say instead,
 *    labeled honestly as that.
 *  - products: the real catalog, so Brand Profile can show what
 *    /api/products/sync actually pulled in without a second page visit.
 */
export async function GET() {
  const brand = await getOrCreateCurrentBrand();

  const angleRows = await db
    .select({ angle: remixedScripts.angle, count: sql<number>`count(*)::int` })
    .from(remixedScripts)
    .where(sql`${remixedScripts.brandProfileId} = ${brand.id} and ${remixedScripts.angle} is not null`)
    .groupBy(remixedScripts.angle);
  const angleCounts = angleRows.map((r) => ({ angle: r.angle!, count: r.count }));

  const brandProducts = await db.select().from(products).where(eq(products.brandProfileId, brand.id));

  const hashtags = brand.hashtags ?? [];
  // trend_items.hashtags keeps the original scraped case ("SkincareIndia"),
  // brand_profiles.hashtags is stored lowercase — a real mismatch caught
  // live (every tag showed 0 coverage before this), not a hypothetical:
  // lower() both sides via jsonb_array_elements_text rather than a
  // case-sensitive @> containment check.
  const hashtagCoverage = hashtags.length
    ? await Promise.all(
        hashtags.map(async (tag) => {
          const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(trendItems)
            .where(
              sql`${trendItems.brandProfileId} = ${brand.id} and exists (
                select 1 from jsonb_array_elements_text(${trendItems.hashtags}) h
                where lower(h) = lower(${tag})
              )`
            );
          return { tag, postCount: row?.count ?? 0 };
        })
      )
    : [];

  return NextResponse.json({ brand, angleCounts, products: brandProducts, hashtagCoverage });
}

export async function PATCH(req: NextRequest) {
  const brand = await getOrCreateCurrentBrand();
  const body = await req.json().catch(() => ({}));

  const updates: Partial<typeof brandProfiles.$inferInsert> = {};
  if (Array.isArray(body.hashtags)) updates.hashtags = body.hashtags;
  if (typeof body.primaryColor === "string") updates.primaryColor = body.primaryColor;
  if (typeof body.secondaryColor === "string") updates.secondaryColor = body.secondaryColor;
  if (typeof body.fontFamily === "string") updates.fontFamily = body.fontFamily;
  if (typeof body.name === "string") updates.name = body.name;
  // Real behavior change, not cosmetic: this is what /api/products/sync
  // reads to know which Shopify store to hit. Was read-only until now —
  // closes the "1b: enter the website" gap from the earlier feature table.
  if (typeof body.domain === "string") updates.domain = body.domain;
  if (typeof body.identity === "string") updates.identity = body.identity;
  if (typeof body.toneOfVoice === "string") updates.toneOfVoice = body.toneOfVoice;
  if (Array.isArray(body.targetSegments)) updates.targetSegments = body.targetSegments;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  const [updated] = await db.update(brandProfiles).set(updates).where(eq(brandProfiles.id, brand.id)).returning();
  return NextResponse.json({ brand: updated });
}
