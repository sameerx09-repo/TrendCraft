import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { remixedScripts, products, trendItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { SKELETONS, type SkeletonId } from "@/lib/render/skeletonLibrary";
import { generateReelCopy } from "@/lib/clients/reelCopywriter";

/** Real regenerate — a fresh AI call for new copy, grounded the same way
 * the initial remix creation is (see generateReelCopy's own doc comment
 * for why this used to be fillSkeleton+generateRemixVoice+
 * generateParodyHook stacked on top of each other). Only works for
 * skeleton-matched scripts (has a hookType and a product tag that resolves
 * to a real catalog row) — that's the only case where "regenerate" has a
 * well-defined meaning; freeform mock-fixture scripts have no product/
 * skeleton structure to regenerate from, so this correctly 400s for those
 * rather than faking an answer. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/scripts/[id]/regenerate">) {
  const { id } = await ctx.params;
  const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, id));
  if (!script) return NextResponse.json({ error: "not found" }, { status: 404 });

  const skeletonId = script.hookType as SkeletonId | null;
  const productTitle = (script.tags as string[] | null)?.[0];
  if (!skeletonId || !productTitle) {
    return NextResponse.json(
      { error: "regenerate only works for skeleton-matched posts (needs hookType + a linked product)" },
      { status: 400 }
    );
  }

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.title, productTitle), eq(products.brandProfileId, script.brandProfileId!)));
  if (!product || !product.slotValues) {
    return NextResponse.json({ error: `no catalog product found for "${productTitle}"` }, { status: 400 });
  }

  const [trendItem] = script.trendItemId
    ? await db.select().from(trendItems).where(eq(trendItems.id, script.trendItemId))
    : [undefined];

  // Preserves whatever clip count this script already has — regenerate
  // rewrites the words, not the video structure a render might already be
  // built against.
  const clipCount = script.beats?.length || 3;

  const slides = await generateReelCopy({
    subjectName: product.title,
    subjectDescription: product.description ?? "",
    clipCount,
    realCaption: trendItem?.caption ?? null,
    skeletonHint: trendItem?.caption ? undefined : { name: SKELETONS[skeletonId].name, example: SKELETONS[skeletonId].evidence.examples[0] },
  });

  const [updated] = await db
    .update(remixedScripts)
    .set({ slides, beats: slides, hook: slides[0] })
    .where(eq(remixedScripts.id, id))
    .returning();

  return NextResponse.json({ script: updated });
}
