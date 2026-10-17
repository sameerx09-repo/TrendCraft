import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, trendItems } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { eq, sql } from "drizzle-orm";
import { removeByUrl } from "@/lib/storage";
import { invalidateTtlCache } from "@/lib/db/ttlCache";

const VALID_STATUSES = ["pending", "kept", "discarded"] as const;

/**
 * Keep/discard action — real per-item status, fixing the mockup's original
 * bug (only a kept-array + count existed, no real per-item status; see
 * phase1_phase2_build_tasklist.md Phase 0 notes on the schema design).
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const status = body.status;

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const [before] = await db.select().from(posts).where(eq(posts.id, id));
  if (status === "kept" && before && !before.renderedFileUrl) {
    const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, before.remixedScriptId));
    if (script?.hookType === "brand_feed_remix" || script?.hookType === "product_edit")
      return NextResponse.json({ error: "This approved edit is not ready yet. Review the finished video before keeping it." }, { status: 409 });
  }

  const [updated] = await db
    .update(posts)
    .set({ status, updatedAt: new Date() })
    .where(eq(posts.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Status just changed — never let /api/review or /api/remixes serve a
  // cached pre-decision snapshot for up to CACHE_TTL_MS after this.
  invalidateTtlCache("review");
  invalidateTtlCache("remixes");

  // Render on keep — matches the review-then-export product flow, no
  // separate "render" action needed. Which render job fires is caller-
  // chosen: "persona_remix" (real, $0-marginal-cost persona-library
  // assembly — see lib/render/personaLibrary.ts) or the default slideshow.
  // Both end up in the same rendered_file_url/renderedAt columns either way.
  //
  // Skipped entirely if the post is already rendered — Review now
  // eagerly generates the real Runway video per card (real $2-8 spend,
  // see /api/posts/[id]/generate-runway) before a decision is even made,
  // so by the time Keep is clicked renderedFileUrl is already set. Firing
  // another render here would silently re-spend on a video that already
  // exists.
  if (status === "kept" && !before?.renderedFileUrl) {
    const eventName =
      body.format === "persona_remix"
        ? "posts/persona-remix.requested"
        : body.format === "artifact_remix"
          ? "posts/artifact-remix.requested"
          : "posts/render.requested";
    await inngest.send({ name: eventName, data: { postId: id } });
  }

  return NextResponse.json({ post: updated });
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ post });
}

/**
 * Deletes one remix (a single tile in Remixes/Generate Content) — the
 * rendered video file, its dedicated remixed_scripts row, and the post
 * itself. Never touches the source trend_item: other remixes may still
 * point at the same reel, and the reel's own history (Content Library
 * velocity tracking, or a Viral Trends admin's sourced artifacts) isn't
 * this action's business — deleting the source reel is a separate,
 * explicit action (DELETE /api/viral-trends/[id]).
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  await removeByUrl(post.renderedFileUrl);
  await db.delete(posts).where(eq(posts.id, id));
  invalidateTtlCache("review");
  invalidateTtlCache("remixes");

  // Every remix creates its own dedicated script in practice (confirmed in
  // remixSkeletonMatchedItems's fill-and-create-posts step — one insert
  // immediately followed by exactly one post insert), but check rather than
  // assume: deleting a script another post still points at would silently
  // break that post's Edit/Regenerate flow.
  const [stillReferenced] = await db.select().from(posts).where(eq(posts.remixedScriptId, post.remixedScriptId));
  if (!stillReferenced) {
    const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
    await db.delete(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
    if (script?.trendItemId) {
      await db
        .update(trendItems)
        .set({ remixCount: sql`greatest(${trendItems.remixCount} - 1, 0)` })
        .where(eq(trendItems.id, script.trendItemId));
    }
  }

  return NextResponse.json({ deleted: true });
}
