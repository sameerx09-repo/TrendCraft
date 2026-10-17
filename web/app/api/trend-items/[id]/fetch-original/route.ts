import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { fetchOriginalReelVideo } from "@/lib/clients/apify";
import { isMockMode } from "@/lib/clients/mockMode";
import { extractReelText } from "@/lib/clients/reelTextExtractor";
import { extractHook } from "@/lib/discovery/extractHook";
import { extractFrames } from "@/lib/render/frames";
import { matchSkeletons } from "@/lib/render/skeletonLibrary";
import { put } from "@/lib/storage";
import { eq } from "drizzle-orm";

/**
 * Real spend (~$0.075/reel), single item, synchronous — the Review card
 * calls this for whichever post is currently on screen, not the whole
 * queue at once, and awaits it directly rather than firing an Inngest
 * event and polling: the whole point is the reviewer sees the real
 * original next to the remix while deciding, so it has to be observable
 * in the same request/response cycle, same reasoning as
 * /api/onboarding/run. Idempotent — skips the real download and returns
 * the existing URL if this trend item was already fetched for real (by
 * this route or the older batch /api/comparisons/prepare), so re-viewing
 * a card never re-spends. A mock-mode fetch does NOT count as "already
 * fetched" — see sourceVideoIsMock below.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/trend-items/[id]/fetch-original">) {
  const { id } = await ctx.params;
  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Only short-circuits a genuinely-real prior fetch (sourceVideoIsMock ===
  // false) — a video downloaded under mock mode is fake data for this
  // specific item, so it must not block a real fetch once mock mode is
  // off. Confirmed live: without this distinction, one mock-mode fetch
  // permanently poisoned an item against ever getting its real video/
  // caption, even after switching to live and retrying.
  if (item.sourceVideoUrl && item.sourceVideoIsMock === false) {
    return NextResponse.json({ sourceVideoUrl: item.sourceVideoUrl, alreadyDownloaded: true });
  }

  try {
    const result = await fetchOriginalReelVideo(item.sourceUrl);
    const url = await put("source-videos", `${item.id}.mp4`, result.buffer);

    const set: Partial<typeof trendItems.$inferInsert> = {
      sourceVideoUrl: url,
      sourceVideoDownloadedAt: new Date(),
      sourceVideoIsMock: isMockMode(),
      updatedAt: new Date(),
    };
    // The real hook is the text baked into the video frames, not Apify's
    // `caption` field (the post's text caption below the video) — confirmed
    // live these are frequently unrelated (a real reel's on-screen joke text
    // vs. its actual Instagram caption being just an unrelated hashtag).
    // What this app actually needs to ground ad copy in is what's ON the
    // reel, so on-screen text wins whenever vision finds any; Apify's
    // caption is only the fallback when there's no overlay to read. Never
    // overwrites a caption an admin already typed in by hand.
    if (!item.caption) {
      const frames = await extractFrames(result.buffer, [0.2, 1.5, 3, 5]);
      const { result: reelText, ok } = await extractReelText(frames);
      const caption = reelText.text ?? result.caption;
      if (caption) {
        set.caption = caption;
        const hookLine = extractHook(caption);
        set.hookLine = hookLine;
        set.matchedSkeletons = matchSkeletons(hookLine);
      }
      // Position/size come from the SAME real video frames the caption text
      // itself was read from — see reelTextExtractor.ts's doc comment for
      // why this replaces relying on Apify's thumbnailUrl (a separate,
      // sometimes completely unrelated cover image) for manual_viral reels.
      // Only cache when the vision call actually ran (ok), same reasoning
      // as captionStyleAnalyzer.ts — a failed call must be retryable, not
      // permanently stuck at null/null.
      if (ok) {
        set.captionPosition = reelText.position;
        set.captionSize = reelText.size;
        set.captionHasBackground = reelText.hasBackground;
        set.captionStyleCheckedAt = new Date();
      }
    }
    if (!item.handle && result.handle) set.handle = result.handle;
    if (!item.thumbnailUrl && result.thumbnailUrl) set.thumbnailUrl = result.thumbnailUrl;

    const [updated] = await db.update(trendItems).set(set).where(eq(trendItems.id, id)).returning();
    return NextResponse.json({ sourceVideoUrl: url, alreadyDownloaded: false, item: updated });
  } catch (e) {
    // Node's native fetch throws a generic "fetch failed" TypeError for
    // any network-level failure, with the real reason only on `.cause`
    // (e.g. ECONNRESET, ETIMEDOUT, a TLS error) — confirmed live this was
    // being silently discarded, leaving a real failure completely
    // undiagnosable from the API response alone.
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.cause : undefined;
    console.error("fetch-original failed", e, cause ? `cause: ${cause}` : "");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "download failed", cause: cause ? String(cause) : undefined },
      { status: 500 }
    );
  }
}
