import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, brandProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createVideoClip, getVideoClipStatus, downloadVideoClip } from "@/lib/clients/runway";
import { buildBeatPrompt, assignBeatRoles } from "@/lib/render/runwayPromptTemplates";
import { renderRunwayMultiClipVideo } from "@/lib/render/renderRunwayMultiClip";
import { savePosterFrame } from "@/lib/render/poster";
import { put } from "@/lib/storage";

const BEAT_DURATION_SECONDS: Record<string, number> = { setup: 4, reveal: 3, proof: 3, button: 3 };
const FPS = 30;

/**
 * Real per-beat Runway generation ($2-8/remix, documented in
 * HANDOVER_runway_persona_remix.md), single post, synchronous — same
 * underlying logic as lib/inngest/functions.ts's generateRunwayRemixForPost
 * (which has never been wired to a UI trigger before this), called directly
 * rather than via an Inngest event so the Review page can await it and show
 * real progress instead of firing into the void. Idempotent: skips
 * generation and returns the existing video if this post was already
 * rendered, so re-viewing a card in Review never re-spends.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/generate-runway">) {
  const { id: postId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Persona-library is the default eager renderer now (see
  // generate-persona), so by the time someone explicitly asks for the
  // real thing, renderedFileUrl is usually already set to a persona
  // render — the plain idempotency check would wrongly treat that as
  // "already rendered" and hand back the free version instead of
  // generating the real one. force:true (only ever sent by the explicit
  // "Generate real AI video" button, never the eager/automatic path) skips
  // that guard on purpose.
  if (post.renderedFileUrl && !body.force) {
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

    const productImageBuffer = await readFile(path.join(process.cwd(), "..", "productCatalog", "productImage.JPG"));
    const productImageDataUri = `data:image/jpeg;base64,${productImageBuffer.toString("base64")}`;

    const beats: string[] = script.beats ?? [];
    const roles = assignBeatRoles(beats);

    const clips: { buffer: Buffer; durationInFrames: number; caption: string }[] = [];
    for (let i = 0; i < beats.length; i++) {
      const role = roles[i];
      const hasProduct = role !== "setup";
      const prompt = buildBeatPrompt({ role, text: beats[i], productImageUrl: hasProduct ? productImageDataUri : undefined });
      const durationSeconds = BEAT_DURATION_SECONDS[role] ?? 3;

      const created = await createVideoClip({
        prompt,
        firstFrameImageUrl: hasProduct ? productImageDataUri : undefined,
        aspectRatio: "9:16",
        durationSeconds,
      });

      let clipStatus = created.status;
      let contentUrl: string | undefined;
      while (clipStatus === "pending" || clipStatus === "processing") {
        await new Promise((r) => setTimeout(r, 5000));
        const polled = await getVideoClipStatus(created.id);
        clipStatus = polled.status;
        contentUrl = polled.contentUrl;
      }
      if (clipStatus === "failed") throw new Error(`Runway clip generation failed for beat ${i} (${role})`);

      const buffer = await downloadVideoClip(created.id, contentUrl);
      clips.push({ buffer, durationInFrames: durationSeconds * FPS, caption: beats[i] });
    }

    const videoBuffer = await renderRunwayMultiClipVideo({ postId, brandName: brand?.name ?? "", clips });
    const url = await put("rendered-posts", `${postId}-runway.mp4`, videoBuffer);
    await savePosterFrame(postId, videoBuffer);

    await db
      .update(posts)
      .set({ format: "runway_remix", renderedFileUrl: url, renderedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, postId));

    return NextResponse.json({ renderedFileUrl: url, alreadyRendered: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "runway generation failed" }, { status: 500 });
  }
}
