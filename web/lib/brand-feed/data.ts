import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { isMockMode } from "@/lib/clients/mockMode";
import { readFeed } from "./store";
import { availableSources } from "./source-availability";
import { buildIdeas, isLocalMedia, mediaType } from "./planner";
import type { FeedData, ReelSource } from "./types";

export async function getFeedData(): Promise<FeedData> {
  const brand = await getOrCreateCurrentBrand();
  const [catalog, trends, state] = await Promise.all([
    db.select().from(products).where(eq(products.brandProfileId, brand.id)),
    db
      .select()
      .from(trendItems)
      .where(
        and(
          eq(trendItems.brandProfileId, brand.id),
          ne(trendItems.platform, "local_upload"),
        ),
      )
      .orderBy(desc(trendItems.readyForRemix), desc(trendItems.scrapedAt))
      .limit(100),
    readFeed(brand.id),
  ]);
  let sources: ReelSource[] = trends.map((t) => {
    const uploaded = (t.artifacts || []).filter(
      (a) => a.status === "uploaded" && a.fileUrl && isLocalMedia(a.fileUrl),
    );
    const media = uploaded.map((a) => ({
      id: a.id,
      src: a.fileUrl!,
      type: mediaType(a.fileUrl!),
    }));
    if (
      !media.length &&
      t.sourceVideoUrl &&
      !t.sourceVideoIsMock &&
      isLocalMedia(t.sourceVideoUrl)
    )
      media.push({
        id: t.id,
        src: t.sourceVideoUrl,
        type: mediaType(t.sourceVideoUrl),
      });
    return {
      id: t.id,
      kind:
        state.sourceKinds[t.id] ||
        (t.platform === "manual_viral" ? "viral" : "trend"),
      title:
        t.title ||
        t.hookLine ||
        t.caption?.split("\n")[0]?.slice(0, 130) ||
        "Untitled reference",
      caption: t.caption || t.hookLine || "",
      sourceUrl: t.sourceUrl,
      thumbnailUrl: t.thumbnailUrl,
      media,
      ready:
        (t.platform === "manual_viral" ? t.readyForRemix : true) &&
        media.length > 0,
    };
  });
  sources = await availableSources([...sources, ...state.samples]);
  if (!state.context.tone)
    state.context.tone = brand.toneOfVoice || "Warm and conversational";
  const summary = {
    name: brand.name,
    identity: brand.identity,
    toneOfVoice: brand.toneOfVoice,
  };
  if (!state.ideas.length)
    state.ideas = buildIdeas({
      brandName: brand.name,
      identity: brand.identity,
      products: catalog,
      sources,
      state,
    });
  // An interrupted local job must not look as though it is still running forever.
  for (const idea of state.ideas)
    if (
      idea.job &&
      ["queued", "rendering"].includes(idea.job.state) &&
      Date.now() - Date.parse(idea.job.updatedAt) > 15 * 60_000
    ) {
      idea.job.state = "failed";
      idea.job.error =
        "Local assembly was interrupted. Your kept idea is preserved.";
    }
  return {
    brand: summary,
    products: catalog,
    sources,
    feed: state,
    mockMode: isMockMode(),
  };
}
