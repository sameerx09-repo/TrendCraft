import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { db } from "@/lib/db/client";
import { products, trendItems } from "@/lib/db/schema";
import { inArray, eq } from "drizzle-orm";
import { SKELETONS, type SkeletonId } from "@/lib/render/skeletonLibrary";

/**
 * Triggers remixSkeletonMatchedItems — the connector between skeleton
 * matching and the product catalog. Real cost: $0 (no API calls, pure DB
 * work); the real spend already happened upstream in /api/products/sync
 * and /api/products/generate-copy, which this depends on.
 */
export async function POST(req: Request) {
  const brand = await getOrCreateCurrentBrand();
  const body = await req.json().catch(() => ({}));
  if (body.productId) {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, body.productId));
    if (!product || product.brandProfileId !== brand.id)
      return NextResponse.json(
        { error: "Product not found." },
        { status: 404 },
      );
  }

  /**
   * remixSkeletonMatchedItems's candidate query requires a matched
   * skeleton (it's the copy-writing format the render fills in — see
   * skeletonLibrary.ts) — for auto-scraped reels that's detected from the
   * caption. A manually-pasted reel often has no caption at all, and
   * requiring the admin to invent one just so it accidentally matches a
   * regex defeats the point of manual sourcing. Single-reel targeting
   * (trendItemIds) can instead pass an explicit `skeletonId` to cover that
   * case — the admin directly picks which proven format to use.
   *
   * BUT once a real caption exists, the picked skeleton doesn't drive
   * content generation at all any more: generateReelCopy
   * (lib/clients/reelCopywriter.ts) writes every line straight from the
   * real caption in one grounded call — matchedSkeletons is kept purely
   * for classification now (the "AUTHORITY SECRET" badge, the "Why this?"
   * panel's corpus evidence), not as a fill-in template. Confirmed live
   * this was a real remaining gap before that redesign: an admin could
   * paste the real caption and the Remix button would STILL stay disabled
   * waiting on a now-cosmetic skeleton pick. A real caption is enough on
   * its own — default to a fixed skeleton automatically (for the
   * classification label) instead of blocking on a choice that no longer
   * changes the actual output. Only reels with NEITHER a caption NOR an
   * explicit skeletonId still need the manual picker, since generateReelCopy
   * needs at least a loose style hint from somewhere when there's no real
   * caption to ground in.
   */
  const DEFAULT_SKELETON_WHEN_CAPTION_EXISTS: SkeletonId = "authority_secret";
  if (Array.isArray(body.trendItemIds) && body.trendItemIds.length > 0) {
    const items = await db
      .select()
      .from(trendItems)
      .where(inArray(trendItems.id, body.trendItemIds));
    if (
      items.length !== new Set(body.trendItemIds).size ||
      items.some((i) => i.brandProfileId !== brand.id)
    )
      return NextResponse.json({ error: "Reel not found." }, { status: 404 });
    const withoutSkeleton = items.filter(
      (i) => (i.matchedSkeletons?.length ?? 0) === 0,
    );
    if (withoutSkeleton.length > 0) {
      const skeletonId =
        (body.skeletonId as SkeletonId | undefined) ?? undefined;
      const explicitlyValid = skeletonId && SKELETONS[skeletonId];
      const stillMissing = withoutSkeleton.filter(
        (i) => !explicitlyValid && !i.caption,
      );
      if (stillMissing.length > 0) {
        return NextResponse.json(
          {
            error:
              "This reel has no content format picked yet — choose one to remix it.",
          },
          { status: 400 },
        );
      }
      for (const item of withoutSkeleton) {
        const resolved = explicitlyValid
          ? (skeletonId as SkeletonId)
          : DEFAULT_SKELETON_WHEN_CAPTION_EXISTS;
        await db
          .update(trendItems)
          .set({ matchedSkeletons: [resolved], updatedAt: new Date() })
          .where(eq(trendItems.id, item.id));
      }
    }
  }

  await inngest.send({
    name: "remix/skeleton-matched.requested",
    data: {
      brandProfileId: brand.id,
      brandName: brand.name,
      limit: body.limit,
      mode: body.mode, // "product" | "brand" | undefined (legacy round-robin)
      productId: body.productId,
      trendItemIds: body.trendItemIds, // Viral Trends page: remix one specific reel
    },
  });

  return NextResponse.json(
    { accepted: true, brandProfileId: brand.id },
    { status: 202 },
  );
}
