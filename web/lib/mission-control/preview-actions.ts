import { createHash } from "node:crypto";
import { isMockMode } from "@/lib/clients/mockMode";
import "server-only";
import { after, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  posts,
  products,
  remixedScripts,
  trendItems,
  brandProfiles,
} from "@/lib/db/schema";
import { ALL_PERSONAS, getPersonaById } from "@/lib/render/personaLibrary";
import { generateReelCopy } from "@/lib/clients/reelCopywriter";
import { invalidateTtlCache } from "@/lib/db/ttlCache";
import { put, get } from "@/lib/storage";
import { savePosterFrame } from "@/lib/render/poster";
import { addActivity, mutateCampaigns, readCampaigns } from "./store";
import { agentRenderRequest } from "./agent-render-authorization";
import {
  assertPreviewApproval,
  assertPreviewCurrent,
  buildPreviewPlan,
  previewInputHash,
  PILOT_CREDITS,
  PILOT_DIRECTION,
} from "./preview-plan";
import type { Campaign, Product } from "./types";
import type { PreviewConcept, PreviewPlan } from "./preview-types";

type Brand = typeof brandProfiles.$inferSelect;
const text = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const find = (campaigns: Campaign[], id: string) => {
  const campaign = campaigns.find((c) => c.id === id);
  if (!campaign) throw new Error("Campaign not found.");
  return campaign;
};
function planFor(
  c: Campaign,
  body: Record<string, unknown>,
  product: Product,
  brandName: string,
) {
  assertPreviewCurrent(
    c.previewPlan,
    body.planId,
    previewInputHash(c.brief, c.directions, product, brandName),
    c.paused,
  );
  if (!c.previewPlan!.reference)
    throw new Error(
      "Prepare a fresh preview to freeze its product reference before approval.",
    );
  return c.previewPlan!;
}
function conceptFor(plan: PreviewPlan, id: unknown) {
  const concept = plan.concepts.find((c) => c.id === id);
  if (!concept) throw new Error("Choose a current preview.");
  return concept;
}
function archive(c: Campaign) {
  if (c.previewPlan)
    c.previewHistory = [
      structuredClone(c.previewPlan),
      ...(c.previewHistory || []),
    ].filter((plan, index) => !!plan.pilot || index < 20);
}
async function frozenReference(plan: PreviewPlan) {
  const reference = plan.reference;
  const match = reference?.src.match(
    /^\/storage\/viral-trend-artifacts\/(preview-reference-[a-f0-9-]+\.(jpg|png|webp))$/,
  );
  if (!reference || !match)
    throw new Error("Prepare a fresh preview with a saved product reference.");
  const bytes = await get("viral-trend-artifacts", match[1]);
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256)
    throw new Error(
      "The saved product reference changed. Prepare a fresh preview.",
    );
  return (
    "data:image/" +
    (match[2] === "jpg" ? "jpeg" : match[2]) +
    ";base64," +
    bytes.toString("base64")
  );
}
function invalidate() {
  invalidateTtlCache("remixes");
  invalidateTtlCache("review");
}
async function savePost(
  postId: string,
  brand: Brand,
  product: typeof products.$inferSelect,
  concept: PreviewConcept,
  pilot: boolean,
  direction: string,
  language: "english" | "hinglish",
  referenceImage: string,
) {
  await db.transaction(async (tx) => {
    const [source] = await tx
      .insert(trendItems)
      .values({
        brandProfileId: brand.id,
        platform: "local_upload",
        sourceUrl: product.sourceUrl + "#preview-" + postId,
        title: product.title,
        handle: brand.name,
        caption: product.description,
        thumbnailUrl: referenceImage,
        unscored: true,
      })
      .returning();
    const [script] = await tx
      .insert(remixedScripts)
      .values({
        brandProfileId: brand.id,
        trendItemId: source.id,
        personaId: concept.personaId || null,
        hookType: pilot
          ? "product_ad"
          : concept.format === "persona"
            ? "ai_ugc"
            : "product_edit",
        hook: concept.scenes[0].caption,
        arc: direction,
        cta: concept.scenes[2].caption,
        beats: concept.scenes.map((s) => s.caption),
        slides: concept.scenes.map((s) => s.caption),
        caption: concept.scenes.map((s) => s.caption).join(" "),
        tags: [product.title],
        language,
      })
      .returning();
    await tx.insert(posts).values({
      id: postId,
      brandProfileId: brand.id,
      remixedScriptId: script.id,
      status: "pending",
      format: "runway_remix",
    });
  });
}
async function jobState(
  brandId: string,
  campaignId: string,
  postId: string,
  state: "rendering" | "complete" | "failed",
  error?: string,
) {
  await mutateCampaigns(brandId, (campaigns) => {
    const c = find(campaigns, campaignId),
      creative = c.creatives.find((r) => r.postId === postId);
    if (creative) {
      creative.state = state;
      creative.error = error;
      creative.updatedAt = new Date().toISOString();
    }
    for (const p of [c.previewPlan, ...(c.previewHistory || [])])
      if (p?.pilot?.postId === postId) {
        p.pilot.state = state;
        p.pilot.error = error;
      }
    if (state !== "rendering")
      addActivity(
        c,
        state === "complete"
          ? "Agent creative ready for review"
          : "Agent production stopped",
        error || creative?.title || "",
      );
  });
  invalidate();
}
export async function handlePreviewAction(
  request: Request,
  body: Record<string, unknown>,
  brand: Brand,
) {
  const action = text(body.action, 40),
    campaignId = text(body.campaignId, 50);
  const campaign = find(await readCampaigns(brand.id), campaignId);
  if (action === "preview-refine" && isMockMode())
    throw new Error(
      "AI refinement is unavailable in Test mode. Catalog previews do not require an AI call.",
    );
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(
          products.id,
          campaign.brief.productId || "00000000-0000-0000-0000-000000000000",
        ),
        eq(products.brandProfileId, brand.id),
      ),
    );
  if (!product?.imageUrl)
    throw new Error("Choose a campaign product with a reference image.");
  if (campaign.paused)
    throw new Error(
      "Resume the campaign before preparing or producing previews.",
    );
  if (action === "preview-prepare" || action === "preview-refine") {
    if (
      campaign.creatives.some(
        (c) => c.state === "queued" || c.state === "rendering",
      )
    )
      throw new Error(
        "Wait for the current production to finish before replacing its previews.",
      );
    const direction = text(body.direction);
    const directions = direction
      ? [...campaign.directions, direction].slice(-20)
      : campaign.directions;
    const initialHash = previewInputHash(
      campaign.brief,
      campaign.directions,
      product,
      brand.name,
    );
    if (action === "preview-refine")
      planFor(campaign, body, product, brand.name);
    const beats =
      action === "preview-refine"
        ? await generateReelCopy({
            subjectName: product.title,
            subjectDescription: [
              product.description,
              campaign.brief.goal,
              campaign.brief.audience,
              campaign.brief.tone,
              campaign.brief.message,
              campaign.brief.preferences,
              ...directions,
              "Use " +
                campaign.brief.language +
                ". No invented testimonials, medical claims or time-bound results.",
            ]
              .filter(Boolean)
              .join("\n"),
            clipCount: 3,
            realCaption: null,
          })
        : undefined;
    const plan = buildPreviewPlan({
      brief: campaign.brief,
      directions,
      product,
      brandName: brand.name,
      personas: ALL_PERSONAS.filter((p) => !!getPersonaById(p.id)),
      beats,
    });
    const image = await fetch(product.imageUrl, {
      signal: AbortSignal.timeout(20000),
    });
    if (!image.ok)
      throw new Error("The product reference image could not be saved.");
    const mime = (image.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[mime];
    if (!extension)
      throw new Error(
        "The product reference must be a JPEG, PNG or WebP image.",
      );
    if (Number(image.headers.get("content-length") || 0) > 16 * 1024 * 1024)
      throw new Error("The product reference is too large.");
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!bytes.length || bytes.length > 16 * 1024 * 1024)
      throw new Error("The product reference image is empty or too large.");
    const src = await put(
      "viral-trend-artifacts",
      "preview-reference-" + plan.id + "." + extension,
      bytes,
    );
    plan.reference = {
      src,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    for (const concept of plan.concepts)
      for (const scene of concept.scenes)
        if (scene.type === "image") scene.src = src;
    await mutateCampaigns(brand.id, (campaigns) => {
      const c = find(campaigns, campaignId);
      if (
        c.paused ||
        previewInputHash(c.brief, c.directions, product, brand.name) !==
          initialHash ||
        c.previewPlan?.id !== campaign.previewPlan?.id ||
        c.creatives.some((r) => ["queued", "rendering"].includes(r.state))
      )
        throw new Error(
          "The campaign changed while preparing this preview. Try again.",
        );
      archive(c);
      c.directions = directions;
      c.previewPlan = plan;
      addActivity(
        c,
        action === "preview-refine"
          ? "AI copy prepared for preview"
          : "Asset-first previews prepared",
        "No Runway generation. " + (direction || product.title),
      );
    });
    return NextResponse.json({ plan });
  }
  if (action === "preview-revise") {
    const captions = Array.isArray(body.captions)
      ? body.captions.map((c) => text(c, 200))
      : [];
    if (captions.length !== 3 || captions.some((c) => !c))
      throw new Error("Provide three non-empty caption lines.");
    let plan: PreviewPlan | undefined;
    await mutateCampaigns(brand.id, (campaigns) => {
      const c = find(campaigns, campaignId),
        current = planFor(c, body, product, brand.name);
      if (c.creatives.some((r) => ["queued", "rendering"].includes(r.state)))
        throw new Error(
          "Wait for current production to finish before revising.",
        );
      conceptFor(current, body.conceptId);
      archive(c);
      plan = structuredClone(current);
      plan.id = crypto.randomUUID();
      plan.createdAt = new Date().toISOString();
      plan.pilot = undefined;
      plan.concepts = plan.concepts.map((concept) => ({
        ...concept,
        id: crypto.randomUUID(),
        approvedAt: undefined,
        postId: undefined,
        scenes: concept.scenes.map((scene, i) => ({
          ...scene,
          caption: concept.id === body.conceptId ? captions[i] : scene.caption,
        })),
      }));
      c.previewPlan = plan;
      addActivity(
        c,
        "Preview revised",
        "Previous approvals do not apply to this version.",
      );
    });
    return NextResponse.json({ plan });
  }
  if (action === "preview-use-pilot") {
    assertPreviewApproval(body.reviewed);
    const current = planFor(campaign, body, product, brand.name);
    if (!current.pilot || current.pilot.state !== "complete")
      throw new Error("A completed pilot is required.");
    const [post] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, current.pilot.postId),
          eq(posts.brandProfileId, brand.id),
        ),
      );
    if (!post?.renderedFileUrl)
      throw new Error("The pilot video is not available.");
    let conceptId = "";
    await mutateCampaigns(brand.id, (campaigns) => {
      const c = find(campaigns, campaignId),
        plan = planFor(c, body, product, brand.name);
      const source = conceptFor(plan, plan.pilot!.conceptId);
      const existing = plan.concepts.find(
        (x) => x.id === "motion-" + plan.pilot!.postId,
      );
      conceptId = existing?.id || "motion-" + plan.pilot!.postId;
      if (!existing) {
        plan.concepts.push({
          ...structuredClone(source),
          id: conceptId,
          title: source.title + " / Motion edition",
          approvedAt: undefined,
          postId: undefined,
          rationale:
            "The reviewed product pilot replaces the product-image beat. Assembly uses existing footage only.",
          scenes: source.scenes.map((s, i) =>
            i === 1
              ? {
                  ...s,
                  type: "video",
                  src: post.renderedFileUrl!,
                  label: "Reviewed product pilot",
                  seconds: 4,
                }
              : s,
          ),
        });
        addActivity(
          c,
          "Product pilot accepted",
          "Motion edition ready for preview approval. No additional Runway generation.",
        );
      }
    });
    return NextResponse.json({ conceptId });
  }
  if (action !== "preview-assemble" && action !== "preview-pilot")
    throw new Error("Unknown preview action.");
  assertPreviewApproval(body.reviewed);
  const pilot = action === "preview-pilot";
  if (pilot && isMockMode())
    throw new Error(
      "Paid product pilots are disabled in Test mode. Switch to Live mode before authorizing a pilot.",
    );
  if (pilot && body.maxCredits !== PILOT_CREDITS)
    throw new Error("Approve the displayed single-shot credit limit.");
  let postId = "",
    fresh = false,
    snapshot: PreviewConcept | undefined,
    frozenPlan: PreviewPlan | undefined;
  await mutateCampaigns(brand.id, async (campaigns) => {
    const c = find(campaigns, campaignId),
      plan = planFor(c, body, product, brand.name),
      concept = conceptFor(plan, body.conceptId);
    if (pilot && plan.pilot) {
      if (plan.pilot.conceptId !== concept.id)
        throw new Error(
          "This preview version already has a pilot. Review it before requesting another.",
        );
      postId = plan.pilot.postId;
      return;
    }
    if (!pilot && concept.postId) {
      postId = concept.postId;
      return;
    }
    if (pilot && c.reservedCredits + PILOT_CREDITS > c.brief.creditCap)
      throw new Error("This pilot exceeds the campaign Runway credit cap.");
    await frozenReference(plan);
    postId = crypto.randomUUID();
    fresh = true;
    concept.approvedAt = new Date().toISOString();
    if (pilot) {
      c.reservedCredits += PILOT_CREDITS;
      plan.pilot = {
        postId,
        conceptId: concept.id,
        approvalId: crypto.randomUUID(),
        authorizedAt: concept.approvedAt,
        credits: PILOT_CREDITS,
        prompt: PILOT_DIRECTION,
        sourceImageUrl: plan.reference!.src,
        state: "queued",
      };
    } else concept.postId = postId;
    c.creatives.unshift({
      postId,
      title: concept.title + (pilot ? " / Product pilot" : ""),
      engine: pilot || concept.format === "product" ? "product" : "ugc",
      state: "queued",
      previewPlanId: plan.id,
      previewConceptId: concept.id,
      agentPilot: pilot,
      createdAt: concept.approvedAt,
      updatedAt: concept.approvedAt,
    });
    addActivity(
      c,
      pilot
        ? "Single product pilot authorized"
        : "Preview approved for assembly",
      pilot
        ? PILOT_CREDITS +
            " credits reserved. One attempt. No automatic paid retry."
        : "Existing assets only. 0 Runway credits.",
    );
    snapshot = structuredClone(concept);
    frozenPlan = structuredClone(plan);
  });
  if (!fresh)
    return NextResponse.json({ postId, alreadyQueued: true }, { status: 202 });
  try {
    await savePost(
      postId,
      brand,
      product,
      snapshot!,
      pilot,
      pilot ? PILOT_DIRECTION : "Approved preview " + frozenPlan!.id,
      campaign.brief.language,
      frozenPlan!.reference!.src,
    );
  } catch (error) {
    await jobState(
      brand.id,
      campaignId,
      postId,
      "failed",
      "Could not save production. No provider request was made.",
    );
    throw error;
  }
  invalidate();
  after(async () => {
    try {
      const latest = find(await readCampaigns(brand.id), campaignId);
      if (
        latest.paused ||
        previewInputHash(
          latest.brief,
          latest.directions,
          product,
          brand.name,
        ) !== frozenPlan!.inputHash
      )
        throw new Error(
          "Campaign changed before production started. No provider request was made.",
        );
      await jobState(brand.id, campaignId, postId, "rendering");
      if (pilot) {
        const imageDataUri = await frozenReference(frozenPlan!);
        const req = agentRenderRequest(
          request.url,
          postId,
          async (taskId) => {
            await mutateCampaigns(brand.id, async (campaigns) => {
              const c = find(campaigns, campaignId);
              for (const p of [c.previewPlan, ...(c.previewHistory || [])])
                if (p?.pilot?.postId === postId)
                  p.pilot.providerTaskId = taskId;
            });
          },
          imageDataUri,
        );
        const response = await (
          await import("@/app/api/product-ads/[postId]/render/route")
        ).POST(req, { params: Promise.resolve({ postId }) });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error ||
              "Product pilot failed. Check the provider task before another attempt.",
          );
      } else {
        const { renderPersonaLibraryRemix } =
          await import("@/lib/render/renderRunwayMultiClip");
        const buffer = await renderPersonaLibraryRemix({
          brandName: brand.name,
          previewStyle: true,
          clips: snapshot!.scenes.map((s) => ({
            type: s.type,
            ...(s.type === "video"
              ? {
                  videoSrc: s.src.startsWith("/storage/")
                    ? new URL(s.src, request.url).href
                    : s.src.replace(/^\//, ""),
                }
              : {
                  imageSrc: s.src.startsWith("/storage/")
                    ? new URL(s.src, request.url).href
                    : s.src,
                }),
            durationInFrames: Math.round(s.seconds * 30),
            caption: s.caption,
            captionPosition: "bottom" as const,
            captionSizeHint: "small" as const,
            captionHasBackground: true,
            fit: "contain" as const,
            muted: true,
            still: true,
          })),
        });
        const url = await put(
          "rendered-posts",
          postId + "-approved-preview.mp4",
          buffer,
        );
        await savePosterFrame(postId, buffer);
        await db
          .update(posts)
          .set({
            renderedFileUrl: url,
            renderedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(posts.id, postId));
      }
      await jobState(brand.id, campaignId, postId, "complete");
    } catch (error) {
      await jobState(
        brand.id,
        campaignId,
        postId,
        "failed",
        error instanceof Error
          ? error.message
          : "Production failed. No automatic retry.",
      );
    }
  });
  return NextResponse.json({ postId, queued: true }, { status: 202 });
}
