import { after, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { posts, remixedScripts } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { getFeedData } from "@/lib/brand-feed/data";
import { mutateFeed } from "@/lib/brand-feed/store";
import { buildIdeas, editIdea } from "@/lib/brand-feed/planner";
import { freezeScenes, renderFeedIdea } from "@/lib/brand-feed/render";
import { invalidateTtlCache } from "@/lib/db/ttlCache";
import type { FeedContext, RemixIdea } from "@/lib/brand-feed/types";

export const maxDuration = 600;
const text = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export async function GET() {
  try {
    return NextResponse.json(await getFeedData());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Your reels could not be loaded.",
      },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const brand = await getOrCreateCurrentBrand(),
      data = await getFeedData();
    let assembly: { idea: RemixIdea; postId: string } | undefined;
    const result = await mutateFeed(brand.id, async (feed) => {
      if (!feed.ideas.length) {
        feed.context = data.feed.context;
        feed.ideas = data.feed.ideas;
      }
      if (body.action === "context") {
        const value = body.context as Partial<FeedContext> | undefined;
        if (!value || typeof value !== "object")
          throw new Error("Add your brand direction.");
        const productId = text(value.productId, 50);
        if (productId && !data.products.some((p) => p.id === productId))
          throw new Error("Choose a product from your catalog.");
        feed.context = {
          productId,
          direction: text(value.direction),
          audience: text(value.audience),
          tone: text(value.tone, 300),
          restrictions: text(value.restrictions),
          language: value.language === "hinglish" ? "hinglish" : "english",
        };
        return { ok: true };
      }
      if (body.action === "batch") {
        feed.batch++;
        const ideas = buildIdeas({
          brandName: brand.name,
          identity: brand.identity,
          products: data.products,
          sources: data.sources.map((s) => ({
            ...s,
            kind: feed.sourceKinds[s.id] || s.kind,
          })),
          state: feed,
        });
        if (!ideas.length)
          throw new Error(
            "Add a ready reel reference or a product image to prepare ideas.",
          );
        feed.ideas = [
          ...ideas,
          ...feed.ideas.filter((i) => i.decision === "kept" || i.job),
        ];
        return { ok: true, count: ideas.length };
      }
      if (body.action === "source-kind") {
        const id = text(body.sourceId, 100);
        if (!data.sources.some((s) => s.id === id && !s.uploadedSample))
          throw new Error("Reference not found.");
        if (!["trend", "viral", "product"].includes(String(body.kind)))
          throw new Error("Choose a reference type.");
        feed.sourceKinds[id] = body.kind as "trend" | "viral" | "product";
        return { ok: true };
      }
      const idea = feed.ideas.find((i) => i.id === body.ideaId);
      if (!idea)
        throw new Error("This idea is no longer available. Refresh your feed.");
      if (body.action === "decision") {
        if (!["new", "kept", "skipped"].includes(String(body.decision)))
          throw new Error("Choose keep or skip.");
        if (
          body.decision === "skipped" &&
          idea.job &&
          ["queued", "rendering"].includes(idea.job.state)
        )
          throw new Error(
            "This version is being assembled. You can review it when it finishes.",
          );
        idea.decision = body.decision as "new" | "kept" | "skipped";
        return { ok: true };
      }
      if (body.action === "edit") {
        editIdea(idea, body.revision, body.captions);
        return { ok: true };
      }
      if (body.action === "assemble") {
        if (body.reviewed !== true || body.revision !== idea.revision)
          throw new Error(
            "Review and approve this exact preview version first.",
          );
        if (idea.decision !== "kept")
          throw new Error("Keep this idea before assembling it.");
        if (idea.job) return { queued: false, postId: idea.job.postId };
        const postId = crypto.randomUUID();
        const frozen = await freezeScenes(idea, postId);
        await db.transaction(async (tx) => {
          const [script] = await tx
            .insert(remixedScripts)
            .values({
              brandProfileId: brand.id,
              trendItemId:
                idea.kind !== "product" && !idea.source?.uploadedSample
                  ? idea.source?.id || null
                  : null,
              personaId: null,
              hookType:
                idea.kind === "product" ? "product_edit" : "brand_feed_remix",
              hook: idea.scenes[0].caption,
              beats: idea.scenes.map((s) => s.caption),
              slides: idea.scenes.map((s) => s.caption),
              caption: idea.caption,
              tags: idea.productName ? [idea.productName] : [brand.name],
              language: feed.context.language,
            })
            .returning();
          await tx
            .insert(posts)
            .values({
              id: postId,
              brandProfileId: brand.id,
              remixedScriptId: script.id,
              format: "artifact_remix",
              status: "pending",
            });
        });
        idea.job = {
          postId,
          state: "queued",
          updatedAt: new Date().toISOString(),
        };
        assembly = {
          idea: { ...structuredClone(idea), scenes: frozen },
          postId,
        };
        return { queued: true, postId };
      }
      throw new Error("Unknown feed action.");
    });
    if (assembly) {
      const job = assembly;
      after(() => renderFeedIdea(brand.id, brand.name, job.idea, job.postId));
      invalidateTtlCache("remixes");
      invalidateTtlCache("review");
    }
    return NextResponse.json(result, { status: assembly ? 202 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "This action could not be completed.",
      },
      { status: 400 },
    );
  }
}
