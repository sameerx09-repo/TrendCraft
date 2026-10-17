import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems, remixedScripts, posts } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { inngest } from "@/lib/inngest/client";

/**
 * Dev proof route for the real per-beat Runway multi-clip job
 * (generateRunwayRemixForPost) — same role as talking-head-test/route.ts.
 * Seeds a remixed_script + pending post with the same 4-beat contrast-joke
 * shape already used as RunwayMultiClipRemix's defaultProps (see
 * remotion/Root.tsx), then fires "posts/runway-remix.requested" so the job
 * can be exercised without needing a real scrape to produce a scored item
 * first. Not a real feature; delete once this is wired to a real UI action.
 */
export async function POST() {
  const brand = await getOrCreateCurrentBrand();

  const [trendItem] = await db
    .insert(trendItems)
    .values({
      brandProfileId: brand.id,
      sourceUrl: `local-test://runway-remix-seed/${Date.now()}`,
      platform: "local_upload",
      title: "Runway remix dev-seed item",
      caption: "Dev-seed item for testing generateRunwayRemixForPost — not a real scraped trend.",
    })
    .returning();

  const [script] = await db
    .insert(remixedScripts)
    .values({
      trendItemId: trendItem.id,
      brandProfileId: brand.id,
      angle: "contrast",
      hookType: "contrast_joke",
      hook: "Skincare trends are temporary.",
      arc: "temporary trend vs. permanent ritual",
      cta: "Some things don't need updating.",
      slides: [],
      beats: [
        "Skincare trends are temporary.",
        "Kumkumadi oil is permanent.",
        "Three ingredients. Centuries of use. Zero reformulation.",
        "Some things don't need updating.",
      ],
      caption: "Skincare trends are temporary. Kumkumadi oil is permanent.",
      tags: ["ayurveda", "skincare"],
    })
    .returning();

  const [post] = await db
    .insert(posts)
    .values({
      remixedScriptId: script.id,
      brandProfileId: brand.id,
      status: "pending",
      score: 80,
      format: "runway_remix",
    })
    .returning();

  await inngest.send({ name: "posts/runway-remix.requested", data: { postId: post.id } });

  return NextResponse.json({ postId: post.id, scriptId: script.id }, { status: 202 });
}
