import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, brandProfiles, trendItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { pickPersona, pickPersonaClip, getPersonaById } from "@/lib/render/personaLibrary";
import { assignBeatRoles } from "@/lib/render/runwayPromptTemplates";
import { renderPersonaLibraryRemix } from "@/lib/render/renderRunwayMultiClip";
import { ensureCaptionStyleAnalyzed } from "@/lib/clients/captionStyleAnalyzer";
import { savePosterFrame } from "@/lib/render/poster";
import { put } from "@/lib/storage";

/**
 * Real, $0-marginal-cost persona-library remix — same underlying logic as
 * lib/inngest/functions.ts's generatePersonaLibraryRemixForPost, called
 * directly so Review can await it, same reasoning as generate-runway's
 * sibling route. This is the DEFAULT eager-render path for Review now —
 * generate-runway (real $2-8/post) is opt-in, not automatic. Confirmed
 * live this was backwards before: every pending post was eagerly calling
 * real Runway regardless of the post's own format, even though
 * format: "runway_remix" has meant "use persona-library on Keep" since
 * remixSkeletonMatchedItems created it (see that function's own comment).
 * Idempotent, same pattern as generate-runway.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/posts/[id]/generate-persona">) {
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

    // Real per-reel caption position/size, not the generic role-based
    // default — read once off this reel's own thumbnail and cached
    // forever after (same lazy-on-first-use, cache-in-DB pattern as
    // product/brand slot values). Analyzed here rather than at batch
    // creation because this is the only place that's guaranteed to run
    // for every post that actually gets rendered — no wasted calls on
    // candidates a batch found but the user never opened.
    const { position: captionPosition, size: captionSize, hasBackground: captionHasBackground } = trendItem && script.hookType !== "ai_ugc"
      ? await ensureCaptionStyleAnalyzed(trendItem)
      : { position: null, size: null, hasBackground: null };

    const beats: string[] = script.beats ?? [];
    const roles = assignBeatRoles(beats);
    // One persona for the whole post (seeded by postId alone, not
    // postId-beatIndex) — a remix mixing different faces across its own
    // beats would look broken. An AI UGC script (Generate AI UGC workflow)
    // has an explicitly admin-picked personaId; everything else (Viral
    // Trends remixes) keeps the existing random seed.
    const persona = (script.personaId && getPersonaById(script.personaId)) || pickPersona(postId);
    // Persist the seeded pick back onto the script — needed for the
    // Persona Library's per-persona video page to query "every post that
    // used Priya" reliably. Without this, that query would have to
    // re-run pickPersona(postId) at read time, which is deterministic
    // today but silently breaks the moment PERSONAS gains or loses an
    // entry (seededIndex's modulo depends on the pool's current length) —
    // confirmed by reading pickPersona's own implementation. Writing it
    // once, here, decouples every already-rendered post from that future
    // change. Only writes when it was genuinely a fresh seeded pick (an
    // AI UGC script already has personaId set and is left alone).
    if (!script.personaId) {
      await db.update(remixedScripts).set({ personaId: persona.id }).where(eq(remixedScripts.id, script.id));
    }
    const clips = roles.map((role, i) => {
      const picked = script.hookType === "ai_ugc" && i === 1 && trendItem?.thumbnailUrl
          ? { type: "image" as const, imageSrc: trendItem.thumbnailUrl, durationInFrames: 90, captionPosition: "bottom" as const }
          : pickPersonaClip(persona, role, postId + "-" + i);
      return {
        ...picked,
        caption: beats[i],
        // The captured style (when we have one) applies uniformly across
        // this post's beats — one source reel, one consistent on-screen
        // style throughout, same as real creators use. Falls back to
        // pickPersonaClip's own role-based default when analysis found no
        // clear caption or hasn't run (e.g. a dead thumbnail URL).
        captionPosition: captionPosition ?? picked.captionPosition,
        captionSizeHint: captionSize ?? undefined,
        captionHasBackground: captionHasBackground ?? undefined,
      };
    });

    const buffer = await renderPersonaLibraryRemix({ brandName: brand?.name ?? "", clips });
    const url = await put("rendered-posts", `${postId}-persona.mp4`, buffer);
    await savePosterFrame(postId, buffer);

    await db
      .update(posts)
      .set({ renderedFileUrl: url, renderedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, postId));

    return NextResponse.json({ renderedFileUrl: url, alreadyRendered: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "persona render failed" }, { status: 500 });
  }
}
