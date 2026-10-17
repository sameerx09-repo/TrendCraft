import { handlePreviewAction } from "@/lib/mission-control/preview-actions";
import { after, NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, products, remixedScripts, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { invalidateTtlCache } from "@/lib/db/ttlCache";
import { ALL_PERSONAS, getPersonaById } from "@/lib/render/personaLibrary";
import { generateReelCopy } from "@/lib/clients/reelCopywriter";
import { isMockMode } from "@/lib/clients/mockMode";
import {
  addActivity,
  mutateCampaigns,
  readCampaigns,
} from "@/lib/mission-control/store";
import {
  EMPTY_BRIEF,
  type Brief,
  type Campaign,
  type Engine,
} from "@/lib/mission-control/types";

export const maxDuration = 600;
const text = (value: unknown, limit = 4000) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
function briefFrom(value: unknown): Brief {
  const b = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const creditCap = Number(b.creditCap);
  return {
    name: text(b.name, 120),
    productId: text(b.productId, 50),
    goal: text(b.goal),
    audience: text(b.audience),
    language: b.language === "hinglish" ? "hinglish" : "english",
    tone: text(b.tone),
    message: text(b.message),
    preferences: text(b.preferences),
    creditCap: Number.isFinite(creditCap)
      ? Math.max(0, Math.min(100000, Math.floor(creditCap)))
      : 300,
  };
}
function findCampaign(campaigns: Campaign[], id: string) {
  const campaign = campaigns.find((c) => c.id === id);
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}
export async function GET() {
  try {
    const brand = await getOrCreateCurrentBrand();
    const [campaigns, catalog, trends, rows] = await Promise.all([
      readCampaigns(brand.id),
      db.select().from(products).where(eq(products.brandProfileId, brand.id)),
      db
        .select()
        .from(trendItems)
        .where(
          and(
            eq(trendItems.brandProfileId, brand.id),
            eq(trendItems.platform, "manual_viral"),
          ),
        )
        .orderBy(desc(trendItems.scrapedAt)),
      db
        .select({ post: posts, script: remixedScripts, trendItem: trendItems })
        .from(posts)
        .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
        .leftJoin(trendItems, eq(remixedScripts.trendItemId, trendItems.id))
        .where(eq(posts.brandProfileId, brand.id))
        .orderBy(desc(posts.createdAt)),
    ]);
    const stale = campaigns
      .flatMap((c) => c.creatives)
      .filter(
        (c) =>
          ["queued", "rendering"].includes(c.state) &&
          Date.now() - Date.parse(c.updatedAt) > 15 * 60_000,
      );
    if (stale.length) {
      await mutateCampaigns(brand.id, (current) => {
        for (const c of current)
          for (const creative of c.creatives) {
            if (
              stale.some(
                (s) =>
                  s.postId === creative.postId &&
                  s.updatedAt === creative.updatedAt,
              )
            ) {
              creative.state = rows.some(
                (row) =>
                  row.post.id === creative.postId && row.post.renderedFileUrl,
              )
                ? "complete"
                : "failed";
              if (creative.state === "failed")
                creative.error =
                  creative.previewPlanId && !creative.agentPilot
                    ? "Local assembly was interrupted. Prepare a revised Agent preview."
                    : "The render was interrupted. Check your Runway task before retrying.";
              for (const plan of [c.previewPlan, ...(c.previewHistory || [])]) {
                if (plan?.pilot?.postId === creative.postId) {
                  plan.pilot.state =
                    creative.state === "complete" ? "complete" : "failed";
                  plan.pilot.error = creative.error;
                }
              }
              creative.updatedAt = new Date().toISOString();
            }
          }
      });
    }
    return NextResponse.json({
      campaigns: stale.length ? await readCampaigns(brand.id) : campaigns,
      posts: rows,
      products: catalog,
      trends,
      personas: ALL_PERSONAS.filter((p) => getPersonaById(p.id)).map((p) => ({
        id: p.id,
        label: p.label,
        anchorPhoto: p.anchorPhoto,
        setupVideo: getPersonaById(p.id)?.clips.setup[0]?.videoSrc ?? null,
        buttonVideo: getPersonaById(p.id)?.clips.button[0]?.videoSrc ?? null,
      })),
      brand: {
        name: brand.name,
        toneOfVoice: brand.toneOfVoice,
        identity: brand.identity,
      },
      mockMode: isMockMode(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Workspace could not be loaded",
      },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, 40);
    const brand = await getOrCreateCurrentBrand();
    const campaignId = text(body.campaignId, 50);
    if (action.startsWith("preview-"))
      return await handlePreviewAction(request, body, brand);
    if (action === "create" || action === "brief") {
      const brief = briefFrom(body.brief);
      if (!brief.name)
        return NextResponse.json(
          { error: "Give the campaign a name" },
          { status: 400 },
        );
      if (brief.productId) {
        const [product] = await db
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, brief.productId),
              eq(products.brandProfileId, brand.id),
            ),
          );
        if (!product)
          return NextResponse.json(
            { error: "Choose a product from your brand catalog" },
            { status: 400 },
          );
      }
      const campaign = await mutateCampaigns(brand.id, (campaigns) => {
        if (action === "brief") {
          const existing = findCampaign(campaigns, campaignId);
          existing.brief = brief;
          addActivity(
            existing,
            "Campaign brief updated",
            "Existing creatives are preserved.",
          );
          return existing;
        }
        const created: Campaign = {
          id: crypto.randomUUID(),
          brief: { ...EMPTY_BRIEF, ...brief },
          paused: false,
          reservedCredits: 0,
          creatives: [],
          activity: [],
          directions: [],
          createdAt: new Date().toISOString(),
        };
        addActivity(created, "Campaign created", brief.goal);
        campaigns.unshift(created);
        return created;
      });
      return NextResponse.json({ campaign });
    }
    const campaign = (await readCampaigns(brand.id)).find(
      (c) => c.id === campaignId,
    );
    if (!campaign)
      return NextResponse.json(
        { error: "Choose a campaign first" },
        { status: 404 },
      );
    if (action === "direction" || action === "pause" || action === "revision") {
      await mutateCampaigns(brand.id, (campaigns) => {
        const c = findCampaign(campaigns, campaignId);
        if (action === "pause") {
          c.paused = body.paused === true;
          addActivity(
            c,
            c.paused ? "Agent paused" : "Agent resumed",
            "Running renders continue.",
          );
        } else if (action === "direction") {
          const direction = text(body.direction);
          if (!direction) throw new Error("Add a direction first");
          c.directions.push(direction);
          c.directions = c.directions.slice(-20);
          addActivity(c, "Creative direction saved", direction);
        } else {
          const creative = c.creatives.find((x) => x.postId === body.postId);
          if (!creative) throw new Error("Creative not found in this campaign");
          if (c.paused)
            throw new Error("Resume the campaign before queuing production.");
          if (creative.previewPlanId)
            throw new Error(
              "Approve this creative from its current Agent preview. Workspace cannot reuse an Agent spending approval.",
            );
          const notes = text(body.notes);
          if (!notes) throw new Error("Add revision notes first");
          creative.notes = notes;
          creative.state = "changes";
          creative.updatedAt = new Date().toISOString();
          addActivity(c, "Changes requested", notes);
        }
      });
      return NextResponse.json({ ok: true });
    }
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
    if (action === "plan") {
      if (campaign.paused)
        return NextResponse.json(
          { error: "Resume the agent before preparing a plan" },
          { status: 409 },
        );
      if (!product)
        return NextResponse.json(
          { error: "Choose a product in the campaign brief" },
          { status: 400 },
        );
      let sourceCaption: string | null = null;
      if (body.engine === "remix") {
        const [source] = await db
          .select()
          .from(trendItems)
          .where(
            and(
              eq(trendItems.id, text(body.trendId, 50)),
              eq(trendItems.brandProfileId, brand.id),
              eq(trendItems.readyForRemix, true),
            ),
          );
        if (!source)
          return NextResponse.json(
            { error: "Select a ready trend before adapting its copy." },
            { status: 400 },
          );
        sourceCaption = source.caption || source.hookLine;
      }
      const beats = await generateReelCopy({
        subjectName: product.title,
        subjectDescription: [
          product.description,
          campaign.brief.goal,
          campaign.brief.message,
          campaign.brief.tone,
          "Write the copy in " + campaign.brief.language,
          ...campaign.directions,
        ]
          .filter(Boolean)
          .join("\n"),
        clipCount: 3,
        realCaption: sourceCaption,
      });
      await mutateCampaigns(brand.id, (campaigns) =>
        addActivity(
          findCampaign(campaigns, campaignId),
          "Campaign copy prepared",
          product.title,
        ),
      );
      return NextResponse.json({ beats });
    }
    if (action === "draft") {
      if (!product)
        return NextResponse.json(
          { error: "Choose a product in the campaign brief" },
          { status: 400 },
        );
      const engine = body.engine as Engine;
      if (!["remix", "ugc", "product"].includes(engine))
        return NextResponse.json(
          { error: "Choose a creative engine" },
          { status: 400 },
        );
      const beats = Array.isArray(body.beats)
        ? body.beats
            .filter((x): x is string => typeof x === "string")
            .slice(0, 3)
            .map((x) => x.trim().slice(0, 2000))
        : [];
      if (beats.length !== 3 || beats.some((x) => !x))
        return NextResponse.json(
          { error: "Add a hook, product reveal and closing line" },
          { status: 400 },
        );
      const personaId = text(body.personaId, 50);
      if (engine === "ugc" && !getPersonaById(personaId))
        return NextResponse.json(
          { error: "Choose a ready persona" },
          { status: 400 },
        );
      let trendId: string;
      let format: "artifact_remix" | "runway_remix" = "runway_remix";
      if (engine === "remix") {
        const [trend] = await db
          .select()
          .from(trendItems)
          .where(
            and(
              eq(trendItems.id, text(body.trendId, 50)),
              eq(trendItems.brandProfileId, brand.id),
              eq(trendItems.readyForRemix, true),
            ),
          );
        if (!trend)
          return NextResponse.json(
            { error: "Choose a trend marked ready for remix" },
            { status: 400 },
          );
        trendId = trend.id;
        if (trend.artifacts?.some((a) => a.status === "uploaded" && a.fileUrl))
          format = "artifact_remix";
      } else {
        if (!product.imageUrl)
          return NextResponse.json(
            { error: "This product needs a reference image" },
            { status: 400 },
          );
        const [trend] = await db
          .insert(trendItems)
          .values({
            brandProfileId: brand.id,
            platform: "local_upload",
            sourceUrl:
              product.sourceUrl + "#" + engine + "-" + crypto.randomUUID(),
            title: product.title,
            handle: brand.name,
            caption: product.description,
            thumbnailUrl: product.imageUrl,
            hookLine: product.title,
            unscored: true,
          })
          .returning();
        trendId = trend.id;
      }
      const [script] = await db
        .insert(remixedScripts)
        .values({
          brandProfileId: brand.id,
          trendItemId: trendId,
          personaId: engine === "ugc" ? personaId : null,
          hookType:
            engine === "product"
              ? "product_ad"
              : engine === "ugc"
                ? "ai_ugc"
                : "campaign_remix",
          hook: beats[0],
          arc: engine === "product" ? text(body.creativeDirection) : beats[1],
          cta: beats[2],
          beats,
          slides: beats,
          caption: text(body.caption) || beats.join(" "),
          tags: [product.title],
          language: campaign.brief.language,
        })
        .returning();
      const [post] = await db
        .insert(posts)
        .values({
          brandProfileId: brand.id,
          remixedScriptId: script.id,
          status: "pending",
          format,
        })
        .returning();
      const title = text(body.title, 160) || product.title + " / " + engine;
      await mutateCampaigns(brand.id, (campaigns) => {
        const c = findCampaign(campaigns, campaignId);
        c.creatives.unshift({
          postId: post.id,
          engine,
          title,
          state: "draft",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        addActivity(c, "Storyboard saved", title);
      });
      invalidateTtlCache("remixes");
      invalidateTtlCache("review");
      return NextResponse.json({ postId: post.id });
    }
    if (action === "render") {
      const postId = text(body.postId, 50);
      const [row] = await db
        .select({ post: posts, script: remixedScripts })
        .from(posts)
        .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
        .where(and(eq(posts.id, postId), eq(posts.brandProfileId, brand.id)));
      if (!row)
        return NextResponse.json(
          { error: "Creative not found" },
          { status: 404 },
        );
      if (row.post.renderedFileUrl)
        return NextResponse.json({ alreadyRendered: true });
      const queued = await mutateCampaigns(brand.id, (campaigns) => {
        const c = findCampaign(campaigns, campaignId);
        const creative = c.creatives.find((x) => x.postId === postId);
        if (!creative) throw new Error("Creative not found in this campaign");
        if (c.paused)
          throw new Error("Resume the campaign before queuing production.");
        if (creative.previewPlanId)
          throw new Error(
            "Approve this creative from its current Agent preview. Workspace cannot reuse an Agent spending approval.",
          );
        if (["queued", "rendering"].includes(creative.state)) return false;
        const cost = creative.engine === "product" ? 48 : 0;
        if (c.reservedCredits + cost > c.brief.creditCap)
          throw new Error(
            "This render exceeds the campaign Runway credit cap. Update the brief first.",
          );
        c.reservedCredits += cost;
        creative.state = "queued";
        creative.error = undefined;
        creative.updatedAt = new Date().toISOString();
        addActivity(c, "Render queued", creative.title);
        return true;
      });
      if (queued)
        after(async () => {
          try {
            await mutateCampaigns(brand.id, (campaigns) => {
              const creative = findCampaign(
                campaigns,
                campaignId,
              ).creatives.find((x) => x.postId === postId)!;
              creative.state = "rendering";
              creative.updatedAt = new Date().toISOString();
            });
            const req = new NextRequest(
              new URL("/api/posts/" + postId, request.url),
            );
            const context = { params: Promise.resolve({ id: postId }) };
            const response =
              row.script.hookType === "product_ad"
                ? await (
                    await import("@/app/api/product-ads/[postId]/render/route")
                  ).POST(req, { params: Promise.resolve({ postId }) })
                : row.post.format === "artifact_remix"
                  ? await (
                      await import("@/app/api/posts/[id]/generate-artifact-remix/route")
                    ).POST(req, context)
                  : await (
                      await import("@/app/api/posts/[id]/generate-persona/route")
                    ).POST(req, context);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Render failed");
            await mutateCampaigns(brand.id, (campaigns) => {
              const c = findCampaign(campaigns, campaignId);
              const creative = c.creatives.find((x) => x.postId === postId)!;
              creative.state = "complete";
              creative.updatedAt = new Date().toISOString();
              addActivity(c, "Creative ready for review", creative.title);
            });
            invalidateTtlCache("remixes");
            invalidateTtlCache("review");
          } catch (error) {
            await mutateCampaigns(brand.id, (campaigns) => {
              const c = findCampaign(campaigns, campaignId);
              const creative = c.creatives.find((x) => x.postId === postId)!;
              creative.state = "failed";
              creative.error =
                error instanceof Error ? error.message : "Render failed";
              creative.updatedAt = new Date().toISOString();
              addActivity(c, "Render failed", creative.error);
            });
          }
        });
      return NextResponse.json({ queued }, { status: 202 });
    }
    return NextResponse.json(
      { error: "Unknown workspace action" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Workspace action failed",
      },
      { status: 400 },
    );
  }
}
