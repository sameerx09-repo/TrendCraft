import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, brandProfiles, trendItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { renderPersonaLibraryRemix, bustBundleCacheForNewPublicFiles } from "@/lib/render/renderRunwayMultiClip";
import { prepareArtifactClip } from "@/lib/render/artifactMedia";
import { distributeBeatsAcrossClips } from "@/lib/render/skeletonLibrary";
import { ensureCaptionStyleAnalyzed } from "@/lib/clients/captionStyleAnalyzer";
import { savePosterFrame } from "@/lib/render/poster";
import { put } from "@/lib/storage";

/**
 * Eager sibling to generate-persona/route.ts — same synchronous,
 * idempotent shape, for posts whose trend item has real uploaded Viral
 * Trends artifacts (format: "artifact_remix", set at creation time in
 * remixSkeletonMatchedItems) instead of the generic persona-library pool.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/posts/[id]/generate-artifact-remix">) {
  const { id: postId } = await ctx.params;

  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (post.renderedFileUrl) {
    return NextResponse.json({ renderedFileUrl: post.renderedFileUrl, alreadyRendered: true });
  }

  try {
    const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
    if (script.hookType === "brand_feed_remix" || script.hookType === "product_edit") {
      return NextResponse.json({ error: "This preview uses an approved asset-only edit. Open For your brand to manage its assembly." }, { status: 409 });
    }
    const [brand] = post.brandProfileId
      ? await db.select().from(brandProfiles).where(eq(brandProfiles.id, post.brandProfileId))
      : [undefined];
    const [trendItem] = script.trendItemId ? await db.select().from(trendItems).where(eq(trendItems.id, script.trendItemId)) : [];

    const uploaded = (trendItem?.artifacts ?? []).filter((a) => a.status === "uploaded" && a.fileUrl);
    if (uploaded.length === 0) {
      return NextResponse.json({ error: `trend item ${trendItem?.id} has no uploaded artifacts` }, { status: 400 });
    }
    const beats: string[] = script.beats ?? [];

    // Distributes the 3-line copy across however many real clips exist —
    // confirmed live that a plain beats[i] mapping meant a single uploaded
    // artifact only ever showed beat 0 (the generic hook), and beats 1/2
    // (the ONLY two lines that ever mention the actual brand/product)
    // silently never appeared. See distributeBeatsAcrossClips's own doc
    // comment: each clip gets a GROUP of one or more beats, played in
    // sequence (not stacked simultaneously) over that clip's duration.
    // Was reading trendItem.captionPosition/captionSize directly — never
    // actually ran the analysis that fills those in for a manual_viral
    // reel, so this always fell back to the hardcoded default (confirmed
    // live twice: two different reels, both stuck on "bottom" until
    // manually patched). ensureCaptionStyleAnalyzed does the same
    // lazy-once-cached analysis generate-persona/route.ts already did,
    // now shared instead of only existing in that one path.
    const styleResult = trendItem
      ? await ensureCaptionStyleAnalyzed(trendItem)
      : { position: null, size: null, hasBackground: null };
    const style = { position: styleResult.position, sizeHint: styleResult.size, hasBackground: styleResult.hasBackground };
    const captionGroups = distributeBeatsAcrossClips(beats, uploaded.length);
    const clips = await Promise.all(
      uploaded.map((artifact, i) =>
        prepareArtifactClip(
          { id: artifact.id, fileUrl: artifact.fileUrl!, label: artifact.label },
          captionGroups[i] ?? [],
          style
        )
      )
    );

    bustBundleCacheForNewPublicFiles();
    const buffer = await renderPersonaLibraryRemix({ brandName: brand?.name ?? "", clips });
    const url = await put("rendered-posts", `${postId}-artifact.mp4`, buffer);
    await savePosterFrame(postId, buffer);

    await db
      .update(posts)
      .set({ renderedFileUrl: url, renderedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, postId));

    return NextResponse.json({ renderedFileUrl: url, alreadyRendered: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "artifact render failed" }, { status: 500 });
  }
}
