import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { db } from "@/lib/db/client";
import { trendItems, remixedScripts, posts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractHook } from "@/lib/discovery/extractHook";
import { matchSkeletons } from "@/lib/render/skeletonLibrary";
import { removeByUrl } from "@/lib/storage";
import { invalidateTtlCache } from "@/lib/db/ttlCache";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/viral-trends/[id]">) {
  const { id } = await ctx.params;
  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

/**
 * Admin-only for now (no auth/role system exists anywhere in this codebase
 * yet — see lib/db/schema.ts's "auth is parked" note on brand_profiles).
 * Shown in the UI without real gating; restrict by role once auth exists.
 * The actual enforcement that matters — never surfacing a not-ready reel
 * during remix — lives in remixSkeletonMatchedItems's candidate query, not
 * here, so this route being open in the meantime doesn't create a real gap.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/viral-trends/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (typeof body.readyForRemix !== "boolean" && typeof body.caption !== "string" && typeof body.handle !== "string") {
    return NextResponse.json({ error: "expected readyForRemix (boolean), caption (string), and/or handle (string)" }, { status: 400 });
  }

  const set: Partial<typeof trendItems.$inferInsert> = { updatedAt: new Date() };

  if (typeof body.readyForRemix === "boolean") {
    /**
     * readyForRemix and artifacts used to be fully independent fields —
     * confirmed live this let a reel sit "✅ Ready" with zero artifacts
     * ever uploaded (readyMarkedAt got set during unrelated testing, with
     * nothing tying it to actual artifact-sourcing progress). Interlinking
     * them per explicit instruction: can't mark ready without at least one
     * uploaded artifact; deleting the last uploaded artifact un-readies it
     * (see the artifacts/[artifactId] DELETE route for that direction).
     */
    if (body.readyForRemix) {
      const [current] = await db.select().from(trendItems).where(eq(trendItems.id, id));
      if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
      const hasUploaded = (current.artifacts ?? []).some((a) => a.status === "uploaded");
      if (!hasUploaded) {
        return NextResponse.json(
          { error: "Can't mark ready — upload at least one artifact first." },
          { status: 400 }
        );
      }
    }
    set.readyForRemix = body.readyForRemix;
    set.readyMarkedAt = body.readyForRemix ? new Date() : null;
  }

  // A reel imported via the "paste links" quick path has no caption at all
  // (only the CSV path collects one) — meaning hookLine/matchedSkeletons
  // are permanently empty and remixSkeletonMatchedItems's candidate query
  // will silently find nothing for it, forever, even once marked ready.
  // Confirmed live: a real reel sat "ready" with an empty caption, Remix
  // was clicked, and 0 candidates were found with no error surfaced
  // anywhere. Setting a caption here recomputes both fields with the same
  // pure, free, local functions the import routes already use, closing
  // that gap instead of leaving paste-imported reels permanently stuck.
  if (typeof body.caption === "string") {
    set.caption = body.caption || null;
    const hookLine = extractHook(body.caption);
    set.hookLine = hookLine;
    set.matchedSkeletons = matchSkeletons(hookLine);
  }
  if (typeof body.handle === "string") {
    set.handle = body.handle || null;
  }

  const [updated] = await db.update(trendItems).set(set).where(eq(trendItems.id, id)).returning();

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  invalidateTtlCache("viral-trends");
  return NextResponse.json({ item: updated });
}

/**
 * Deletes a manually-sourced reel entirely — every remix ever made from it,
 * its uploaded artifact files, and its downloaded source video, then the
 * reel row itself. This is the "permanent, append-only" trendItems table's
 * one real exception: unlike auto-scraped Content Library reels (whose
 * whole point is tracking view-count velocity over time), a manual_viral
 * reel has no such history worth preserving — it's just a link an admin
 * pasted in and can just as validly remove. Content Library reels
 * deliberately have no delete route.
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/viral-trends/[id]">) {
  const { id } = await ctx.params;
  const [item] = await db.select().from(trendItems).where(eq(trendItems.id, id));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const scripts = await db.select().from(remixedScripts).where(eq(remixedScripts.trendItemId, id));
  for (const script of scripts) {
    const scriptPosts = await db.select().from(posts).where(eq(posts.remixedScriptId, script.id));
    for (const post of scriptPosts) {
      await removeByUrl(post.renderedFileUrl);
    }
    await db.delete(posts).where(eq(posts.remixedScriptId, script.id));
  }
  await db.delete(remixedScripts).where(eq(remixedScripts.trendItemId, id));

  for (const artifact of item.artifacts ?? []) {
    if (!artifact.fileUrl) continue;
    await removeByUrl(artifact.fileUrl);
    const key = artifact.fileUrl.split("/").pop()!;
    await unlink(path.join(process.cwd(), "public", "viral-trend-clips", key)).catch(() => {});
  }
  await removeByUrl(item.sourceVideoUrl);

  await db.delete(trendItems).where(eq(trendItems.id, id));
  invalidateTtlCache("viral-trends");

  return NextResponse.json({ deleted: true });
}
