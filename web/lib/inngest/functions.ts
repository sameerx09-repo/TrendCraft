import { inngest } from "./client";
import { db } from "@/lib/db/client";
import { trendItems, remixedScripts, posts, brandProfiles, products, remixBatches } from "@/lib/db/schema";
import { fetchShopifyProducts, stripHtml, type RawShopifyProduct } from "@/lib/clients/productCatalog";
import { generateProductSlotValues } from "@/lib/clients/productCopywriter";
import { generateBrandSlotValues } from "@/lib/clients/brandCopywriter";
import {
  scrapeInstagramReels,
  discoverPopularReels,
  DISCOVERY_KEYWORDS,
  type RawApifyReelItem,
} from "@/lib/clients/apify";
import { extractHook } from "@/lib/discovery/extractHook";
import { matchSkeletons, distributeBeatsAcrossClips, SKELETONS, type SkeletonId } from "@/lib/render/skeletonLibrary";
import { generateReelCopy } from "@/lib/clients/reelCopywriter";
import { ensureCaptionStyleAnalyzed } from "@/lib/clients/captionStyleAnalyzer";
import { fetchTrendingVideos, parseIsoDurationSeconds, type RawYoutubeVideo } from "@/lib/clients/youtube";
import { scoreAndRemix } from "@/lib/clients/claude";
import { renderSlideshowVideo } from "@/lib/render/renderSlideshow";
import { createVideoClip, getVideoClipStatus, downloadVideoClip } from "@/lib/clients/runway";
import { buildBeatPrompt, assignBeatRoles } from "@/lib/render/runwayPromptTemplates";
import { renderRunwayMultiClipVideo, renderPersonaLibraryRemix, bustBundleCacheForNewPublicFiles } from "@/lib/render/renderRunwayMultiClip";
import { pickPersona, pickPersonaClip, getPersonaById } from "@/lib/render/personaLibrary";
import { prepareArtifactClip } from "@/lib/render/artifactMedia";
import { put } from "@/lib/storage";
import { savePosterFrame } from "@/lib/render/poster";
import { eq, sql, and, inArray, notInArray, isNull, desc } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";

type TrendItemRow = typeof trendItems.$inferSelect;

/**
 * Phase 0 smoke-test function — confirms the Inngest local dev server can
 * reach app/api/inngest and execute a step. Kept around as a minimal
 * connectivity check; not used by any real feature.
 */
export const helloWorld = inngest.createFunction(
  { id: "hello-world", triggers: { event: "test/hello" } },
  async ({ event, step }) => {
    const result = await step.run("say-hello", async () => {
      return `Hello, ${event.data.name ?? "world"} — Inngest is wired up.`;
    });
    return { message: result };
  }
);

/**
 * Score + remix any not-yet-scored trend_items for a brand, using the mock
 * Claude client (see phase1_phase2_build_tasklist.md — real Claude
 * integration deliberately out of scope; no ANTHROPIC_API_KEY available).
 * Creates one remixed_scripts + one pending post per newly-scored item.
 * Not user-triggered (trendcraft_implementation_plan.md: "there is no
 * 'Remix this one' button") — runs automatically as the second half of a
 * scrape, and is also exposed standalone for re-runs.
 *
 * Scoped to an explicit list of trend_item IDs (the ones THIS function call
 * just upserted), not a broad "all unscored for brand" query. Two scrape
 * functions (Apify + YouTube) run concurrently off one "Refresh trends"
 * click — a broad query race-conditioned: both saw the same unscored rows
 * before either had written scores, so both remixed every item, doubling
 * every post. Caught by actually inspecting the review queue, not assumed.
 */
// Exported for direct reuse by app/api/onboarding/run/route.ts — the
// onboarding pipeline screen needs real per-step progress, which Inngest's
// fire-and-forget event model can't stream back to the browser, so that
// route calls the same underlying logic directly (same pattern
// scripts/buildComparisons.ts already uses successfully) instead of going
// through inngest.send().
export async function scoreAndRemixItems(itemIds: string[], brandName: string) {
  if (itemIds.length === 0) return [];
  const candidates = await db
    .select()
    .from(trendItems)
    .where(and(inArray(trendItems.id, itemIds), isNull(trendItems.relevanceScore)));

  const created = [];
  for (const item of candidates as TrendItemRow[]) {
    const result = await scoreAndRemix(item.sourceUrl, item.caption ?? "", brandName);

    await db
      .update(trendItems)
      .set({
        relevanceScore: result.relevanceScore,
        finalScore: result.relevanceScore,
        extractedHook: result.extractedHook,
        extractedArc: result.extractedArc,
        extractedBeats: result.extractedBeats,
        remixCount: sql`${trendItems.remixCount} + 1`,
        lastRemixedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trendItems.id, item.id));

    const [script] = await db
      .insert(remixedScripts)
      .values({
        trendItemId: item.id,
        brandProfileId: item.brandProfileId,
        angle: result.remix.angle,
        hookType: result.remix.hookType,
        hook: result.remix.hook,
        arc: result.remix.arc,
        cta: result.remix.cta,
        slides: result.remix.slides,
        beats: result.remix.beats,
        caption: result.remix.caption,
        tags: result.remix.tags,
      })
      .returning();

    const [post] = await db
      .insert(posts)
      .values({
        remixedScriptId: script.id,
        brandProfileId: item.brandProfileId,
        status: "pending",
        score: result.relevanceScore,
        format: "slideshow",
      })
      .returning();

    created.push({ trendItemId: item.id, scriptId: script.id, postId: post.id });
  }
  return created;
}

/**
 * Real Phase 1 discovery job — replaces the /api/dev/seed proof route's
 * hardcoded hashtag list. Triggered by event "trends/scrape.requested"
 * with { brandProfileId, hashtags, resultsLimit }.
 *
 * On-demand only (needs_deep_dive.md A2 — MVP is not scheduled/cron'd).
 * Upsert-on-source_url carries the previous view count and scrape time
 * forward into prev_view_count / prev_scraped_at so the second scrape of
 * the same reel onward yields real measured velocity (C4) — first
 * encounter leaves those columns null, which is the expected "no velocity
 * yet" state, not a bug.
 *
 * Chains straight into scoring/remix for the items it just upserted — see
 * scoreAndRemixItems — so a refresh produces review-queue-ready
 * posts in one pass, matching the product's "not user-triggered" remix
 * design.
 */
export const scrapeTrendsForBrand = inngest.createFunction(
  { id: "scrape-trends-for-brand", triggers: { event: "trends/scrape.requested" } },
  async ({ event, step }) => {
    const { brandProfileId, brandName, hashtags, resultsLimit } = event.data as {
      brandProfileId: string;
      brandName: string;
      hashtags: string[];
      resultsLimit?: number;
    };

    const rawItems = await step.run("scrape-apify", async () => {
      return scrapeInstagramReels(hashtags, resultsLimit ?? 10);
    });

    const upserted = await step.run("upsert-trend-items", async () => {
      const results = [];
      for (const raw of rawItems as RawApifyReelItem[]) {
        const [row] = await db
          .insert(trendItems)
          .values({
            brandProfileId,
            sourceUrl: raw.url,
            platform: "instagram",
            title: raw.caption,
            handle: raw.ownerUsername,
            caption: raw.caption,
            hashtags: raw.hashtags,
            audioTrackName: raw.musicInfo?.song_name,
            audioId: raw.musicInfo?.audio_id,
            durationSeconds: raw.videoDuration,
            viewCount: raw.videoPlayCount ?? raw.igPlayCount,
            likeCount: raw.likesCount,
            commentCount: raw.commentsCount,
            hookLine: extractHook(raw.caption),
            matchedSkeletons: matchSkeletons(extractHook(raw.caption)),
            scrapedAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [trendItems.brandProfileId, trendItems.sourceUrl],
            set: {
              prevViewCount: sql`${trendItems.viewCount}`,
              prevScrapedAt: sql`${trendItems.scrapedAt}`,
              viewCount: raw.videoPlayCount ?? raw.igPlayCount,
              likeCount: raw.likesCount,
              commentCount: raw.commentsCount,
              caption: raw.caption,
              hashtags: raw.hashtags,
              // recomputed on refresh: captions get edited, and the skeleton
              // library grows, so a re-scrape should re-evaluate rather than
              // keep a match made against an older library
              hookLine: extractHook(raw.caption),
              matchedSkeletons: matchSkeletons(extractHook(raw.caption)),
              scrapedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();
        results.push(row);
      }
      return results;
    });

    const remixed = await step.run("score-and-remix", async () => {
      return scoreAndRemixItems(
        upserted.map((r) => r.id),
        brandName
      );
    });

    return { scraped: rawItems.length, upserted: upserted.length, remixed: remixed.length };
  }
);

/**
 * CROSS-NICHE DISCOVERY — popularity-ranked, deliberately not brand-scoped.
 *
 * Sibling to scrapeTrendsForBrand rather than a replacement. The two answer
 * different questions: that one watches the brand's own niche (recency-ranked,
 * narrow), this one sources viral formats from anywhere (popularity-ranked,
 * wide) so they can be re-skinned for the brand. Both feed the same
 * trend_items table and the same review queue. See CROSS_NICHE_DISCOVERY.md.
 *
 * Only items whose hook matches a known skeleton get scored/remixed. The rest
 * are still PERSISTED — they are the corpus the next skeleton gets mined from,
 * and re-running discovery after adding a skeleton picks them up via the
 * onConflictDoUpdate recompute. Scoring every viral reel regardless of
 * remixability is exactly what made the old hashtag pipeline fill the review
 * queue with unusable items.
 */
export const discoverPopularTrendsForBrand = inngest.createFunction(
  { id: "discover-popular-trends-for-brand", triggers: { event: "trends/discover.requested" } },
  async ({ event, step }) => {
    const { brandProfileId, brandName, keywords, resultsLimit } = event.data as {
      brandProfileId: string;
      brandName: string;
      keywords?: string[];
      resultsLimit?: number;
    };

    const rawItems = await step.run("discover-popular", async () => {
      return discoverPopularReels(keywords ?? DISCOVERY_KEYWORDS, resultsLimit ?? 40);
    });

    const upserted = await step.run("upsert-and-match", async () => {
      const results: { id: string; matched: boolean }[] = [];
      for (const raw of rawItems as RawApifyReelItem[]) {
        const hookLine = extractHook(raw.caption);
        const matched = matchSkeletons(hookLine);
        const [row] = await db
          .insert(trendItems)
          .values({
            brandProfileId,
            sourceUrl: raw.url,
            platform: "instagram",
            title: raw.caption,
            handle: raw.ownerUsername,
            caption: raw.caption,
            hashtags: raw.hashtags,
            audioTrackName: raw.musicInfo?.song_name,
            audioId: raw.musicInfo?.audio_id,
            durationSeconds: raw.videoDuration,
            viewCount: raw.videoPlayCount ?? raw.igPlayCount,
            likeCount: raw.likesCount,
            commentCount: raw.commentsCount,
            hookLine,
            matchedSkeletons: matched,
            scrapedAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [trendItems.brandProfileId, trendItems.sourceUrl],
            set: {
              prevViewCount: sql`${trendItems.viewCount}`,
              prevScrapedAt: sql`${trendItems.scrapedAt}`,
              viewCount: raw.videoPlayCount ?? raw.igPlayCount,
              likeCount: raw.likesCount,
              commentCount: raw.commentsCount,
              caption: raw.caption,
              hookLine,
              matchedSkeletons: matched,
              scrapedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();
        results.push({ id: row.id, matched: matched.length > 0 });
      }
      return results;
    });

    const remixableIds = upserted.filter((r) => r.matched).map((r) => r.id);

    const remixed = await step.run("score-and-remix-matched", async () => {
      if (!remixableIds.length) return [];
      return scoreAndRemixItems(remixableIds, brandName);
    });

    return {
      discovered: rawItems.length,
      upserted: upserted.length,
      skeletonMatched: remixableIds.length,
      remixed: remixed.length,
    };
  }
);

/**
 * PRODUCT CATALOG SYNC. Real data — glo-vibe.com is a genuinely live
 * Shopify store, not a placeholder (fixtures/shopify/sample-products.json
 * is captured from it). This is what finally gives the skeleton library's
 * {product} slot a real data source instead of a hand-typed string; see
 * lib/db/schema.ts's products table comment for the concrete bug that
 * caught ("Kumkumadi Night Renewal Cream" doesn't exist as a product).
 *
 * slotValues is deliberately left null here — synthesizing a skeleton-ready
 * payoff line from body_html is a real model call (OPENROUTER_API_KEY is
 * available for it), not something to fake from a text truncation. That's
 * the next function to build, not this one.
 */
export const syncProductCatalogForBrand = inngest.createFunction(
  { id: "sync-product-catalog-for-brand", triggers: { event: "products/sync.requested" } },
  async ({ event, step }) => {
    const { brandProfileId, domain } = event.data as { brandProfileId: string; domain: string };

    const rawProducts = await step.run("fetch-shopify-catalog", async () => {
      return fetchShopifyProducts(domain);
    });

    const upserted = await step.run("upsert-products", async () => {
      const results = [];
      for (const raw of rawProducts as RawShopifyProduct[]) {
        const [row] = await db
          .insert(products)
          .values({
            brandProfileId,
            externalId: String(raw.id),
            handle: raw.handle,
            title: raw.title,
            productType: raw.product_type || null,
            description: raw.body_html ? stripHtml(raw.body_html) : null,
            imageUrl: raw.images?.[0]?.src ?? null,
            price: raw.variants?.[0]?.price ?? null,
            sourceUrl: `https://${domain}/products/${raw.handle}`,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [products.brandProfileId, products.sourceUrl],
            set: {
              title: raw.title,
              productType: raw.product_type || null,
              description: raw.body_html ? stripHtml(raw.body_html) : null,
              imageUrl: raw.images?.[0]?.src ?? null,
              price: raw.variants?.[0]?.price ?? null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();
        results.push(row);
      }
      return results;
    });

    return { fetched: rawProducts.length, upserted: upserted.length };
  }
);

/**
 * The one paid step in the product-catalog pipeline. Deliberately a
 * separate function/trigger from syncProductCatalogForBrand (free) rather
 * than chained automatically after it — so a catalog re-sync never silently
 * re-spends on copywriting, and the caller controls when that cost happens.
 *
 * Only generates for products with no slotValues yet (isNull check), so
 * re-running this after adding a 6th product doesn't re-pay for the other
 * five. There's no change-detection on description edits yet — a real
 * catalog update wouldn't regenerate stale copy — that's a known gap, not
 * an oversight; hashing body_html to detect drift is the natural next step
 * once this is proven.
 */
export const generateProductCopyForBrand = inngest.createFunction(
  { id: "generate-product-copy-for-brand", triggers: { event: "products/generate-copy.requested" } },
  async ({ event, step }) => {
    const { brandProfileId } = event.data as { brandProfileId: string };

    const pending = await step.run("find-pending-products", async () => {
      return db
        .select()
        .from(products)
        .where(and(eq(products.brandProfileId, brandProfileId), isNull(products.slotValues)));
    });

    const results = [];
    // Each product is its own step: a mid-run failure retries only the
    // products that hadn't been paid for yet, not the whole batch.
    for (const product of pending) {
      const row = await step.run(`generate-copy-${product.id}`, async () => {
        const slotValues = await generateProductSlotValues({
          title: product.title,
          productType: product.productType,
          description: product.description,
        });
        const [updated] = await db
          .update(products)
          .set({ slotValues, updatedAt: new Date() })
          .where(eq(products.id, product.id))
          .returning();
        return updated;
      });
      results.push(row);
    }

    return { candidatesFound: pending.length, generated: results.length };
  }
);

/**
 * THE CONNECTOR. Before this function, matchSkeletons() tagged trend_items
 * and the products table held real slot values — two subsystems that worked
 * in isolation and had never been wired together, so nothing in the review
 * queue actually used either. This is what selects skeleton-matched reels,
 * maps each to a real product, and fills the skeleton with that product's
 * real slotValues — replacing the mock Claude placeholder text with real,
 * distinct, product-grounded copy for these items.
 *
 * SELECTION: highest view count first among skeleton-matched items with
 * remixCount = 0 (never remixed before — re-running this doesn't create
 * duplicates for the same trend item). Plays is the only honest ranking
 * signal available; there's no product-fit score.
 *
 * PRODUCT MAPPING: plain rotation across the brand's catalog, not
 * content-based matching. The source reels are DELIBERATELY cross-niche —
 * a cleaning-hack reel's topic has no real bearing on which GloVibe product
 * fits it, since the entire point of this pipeline is borrowing structure,
 * not topic (CROSS_NICHE_DISCOVERY.md). There is no honest signal to match
 * on beyond giving every product roughly equal exposure. Flagged as a real
 * simplification, not hidden — content-based matching (via productType or
 * a real model call) is the natural v2.
 *
 * Requires slotValues to already exist (generateProductCopyForBrand must
 * have run) — a product with no slotValues is skipped, never given
 * fabricated placeholder copy.
 *
 * The beats array [setup, reveal, button] is exactly 3 items, which
 * assignBeatRoles() (lib/render/runwayPromptTemplates.ts) maps back to
 * setup/reveal/button on a 3-item array — so generatePersonaLibraryRemixForPost
 * (the existing, already-working render function) can render these posts
 * completely unchanged.
 */
export const remixSkeletonMatchedItems = inngest.createFunction(
  { id: "remix-skeleton-matched-items", triggers: { event: "remix/skeleton-matched.requested" } },
  async ({ event, step }) => {
    const { brandProfileId, limit, mode, productId, batchId, excludeTrendItemIds, trendItemIds } = event.data as {
      brandProfileId: string;
      limit?: number;
      /** Viral Trends page: remix one specific manually-sourced reel instead
       * of the top-N-by-view-count pool. When present, replaces the
       * ranking query below with an exact-id lookup; every other caller
       * (Generate Content's batch flow) omits this and keeps the existing
       * behavior untouched. */
      trendItemIds?: string[];
      /** "product": every candidate reel uses the one product picked in the
       * remix-picker modal, instead of round-robining the whole catalog.
       * "brand": no product at all — every candidate reel is filled with
       * brand-level copy (generateBrandSlotValues), {product} slot becomes
       * the brand name. Omitted: old round-robin behavior, unchanged, for
       * any caller that predates the picker. */
      mode?: "product" | "brand";
      productId?: string;
      /** Set only by the Generate Content page — tags every post this run
       * creates and updates the batch row's status/counts on completion, so
       * that page can poll for "done" and retrieve exactly this run's
       * results. Remixes' legacy "Remix from skeletons" never sends this.
       * Also reused for "Generate 5 more": the batch already exists, this
       * run just adds more posts under the same id instead of creating a
       * new batch row. */
      batchId?: string;
      /** "Generate 5 more" on an existing batch — the trend items already
       * used in that batch, so this run's candidate query skips them and
       * actually returns the NEXT 5 by view count instead of the same top
       * 5 again (the candidate query has no remixCount filter to fall back
       * on for that — see its own comment). */
      excludeTrendItemIds?: string[];
    };
    const take = limit ?? 5; // top 5 reels per the intended workflow

    try {
      return await runRemix();
    } catch (e) {
      if (batchId) {
        await db
          .update(remixBatches)
          .set({ status: "failed", errorMessage: e instanceof Error ? e.message : String(e), completedAt: new Date() })
          .where(eq(remixBatches.id, batchId));
      }
      throw e;
    }

    async function runRemix() {
    const candidates = await step.run("find-skeleton-matched-candidates", async () => {
      // No remixCount filter — a reel being reused is fine (confirmed:
      // remixing borrows the reel's structure, not its topic, so the same
      // source reel legitimately fits many different products/brands).
      // remixCount is still incremented below and still drives the "Used
      // xN" / "Never remixed" labels elsewhere; it just no longer makes a
      // reel permanently ineligible after its first use. Without this, the
      // whole matched-reel pool (only ~40 reels brand-wide) would
      // permanently exhaust itself after one pass, which is exactly what
      // happened live — every one of the 40 had remixCount > 0 and every
      // new batch (any product, any brand) was silently returning 0
      // candidates regardless of what was picked.
      return db
        .select()
        .from(trendItems)
        .where(
          and(
            eq(trendItems.brandProfileId, brandProfileId),
            sql`jsonb_array_length(${trendItems.matchedSkeletons}) > 0`,
            // A manually-sourced Viral Trends reel is never a candidate
            // until an admin has explicitly marked it ready — enforced
            // here (not just trusted to the caller/UI) so it's impossible
            // to remix an incomplete reel through any path, direct or
            // batch-ranked.
            sql`(${trendItems.platform} != 'manual_viral' OR ${trendItems.readyForRemix} = true)`,
            trendItemIds && trendItemIds.length > 0
              ? inArray(trendItems.id, trendItemIds)
              : excludeTrendItemIds && excludeTrendItemIds.length > 0
                ? notInArray(trendItems.id, excludeTrendItemIds)
                : undefined
          )
        )
        .orderBy(desc(sql`coalesce(${trendItems.viewCount}, 0)`))
        .limit(trendItemIds && trendItemIds.length > 0 ? trendItemIds.length : take);
    });

    // Resolves what every candidate this run gets filled with, once, up
    // front — a single product (mode "product"), the brand itself (mode
    // "brand", generating+caching brand-level copy on first use), or null
    // to fall back to the pre-picker round-robin-across-catalog behavior.
    const fixedSubject = await step.run("resolve-remix-subject", async (): Promise<
      | { kind: "product"; product: typeof products.$inferSelect }
      | { kind: "brand"; brandName: string; brandIdentity: string | null; slotValues: Record<string, string> }
      | null
    > => {
      if (mode === "product") {
        if (!productId) throw new Error("mode 'product' requires productId");
        const [product] = await db.select().from(products).where(eq(products.id, productId));
        if (!product) throw new Error(`product ${productId} not found`);
        if (!product.slotValues) throw new Error(`product ${productId} has no slotValues yet — run copy generation first`);
        return { kind: "product", product };
      }
      if (mode === "brand") {
        const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.id, brandProfileId));
        if (!brand) throw new Error(`brand ${brandProfileId} not found`);
        let slotValues = brand.slotValues as Record<string, string> | null;
        if (!slotValues) {
          slotValues = (await generateBrandSlotValues(brand)) as unknown as Record<string, string>;
          await db
            .update(brandProfiles)
            .set({ slotValues: slotValues as { payoff: string; fact: string; objection: string; thing: string } })
            .where(eq(brandProfiles.id, brandProfileId));
        }
        return { kind: "brand", brandName: brand.name, brandIdentity: brand.identity, slotValues };
      }
      return null;
    });

    // Legacy round-robin path only needs the catalog when no explicit
    // subject was picked — a specific product/brand run doesn't touch it.
    const catalog = fixedSubject
      ? []
      : await step.run("load-product-catalog", async () => {
          return db.select().from(products).where(eq(products.brandProfileId, brandProfileId));
        });

    if (!fixedSubject && catalog.length === 0) {
      if (batchId) {
        await db
          .update(remixBatches)
          .set({ status: "failed", errorMessage: "no products in catalog", completedAt: new Date() })
          .where(eq(remixBatches.id, batchId));
      }
      return { created: 0, error: "no products in catalog — POST /api/products/sync first" };
    }

    const created = await step.run("fill-and-create-posts", async () => {
      const results = [];
      let cursor = 0;
      for (const item of candidates) {
        const skeletonId = (item.matchedSkeletons as SkeletonId[])[0];

        let productName: string;
        let productType: string | null;
        let slotValues: Record<string, string>;
        let productIdForResult: string | null;

        if (fixedSubject?.kind === "product") {
          productName = fixedSubject.product.title;
          productType = fixedSubject.product.productType;
          slotValues = fixedSubject.product.slotValues as Record<string, string>;
          productIdForResult = fixedSubject.product.id;
        } else if (fixedSubject?.kind === "brand") {
          productName = fixedSubject.brandName;
          productType = null;
          slotValues = fixedSubject.slotValues;
          productIdForResult = null;
        } else {
          // PRODUCT MAPPING (legacy, no mode given): plain rotation across
          // the brand's catalog — see the doc comment above this function
          // for why there's no honest content-based signal to match on.
          const product = catalog[cursor % catalog.length];
          cursor++;
          if (!product.slotValues) continue; // real skip — generateProductCopyForBrand hasn't run for this product
          productName = product.title;
          productType = product.productType;
          slotValues = product.slotValues as Record<string, string>;
          productIdForResult = product.id;
        }

        // A manual_viral reel with real uploaded artifacts gets its own
        // artifacts rendered instead of a generic persona-library clip —
        // moved up from below so clipCount is known before generating
        // copy (see generateReelCopy's own doc comment for why the whole
        // fillSkeleton/generateRemixVoice/generateParodyHook/
        // distributeBeatsAcrossClips stack it replaces existed in the
        // first place).
        const hasUploadedArtifacts = (item.artifacts ?? []).some((a) => a.status === "uploaded");
        const format = item.platform === "manual_viral" && hasUploadedArtifacts ? "artifact_remix" : "runway_remix";
        const clipCount =
          format === "artifact_remix" ? (item.artifacts ?? []).filter((a) => a.status === "uploaded").length : 3;

        const subjectDescription =
          fixedSubject?.kind === "product"
            ? fixedSubject.product.description ?? ""
            : fixedSubject?.kind === "brand"
              ? fixedSubject.brandIdentity ?? ""
              : slotValues.payoff ?? "";

        const beats = await generateReelCopy({
          subjectName: productName,
          subjectDescription,
          clipCount,
          realCaption: item.caption,
          skeletonHint: item.caption ? undefined : { name: SKELETONS[skeletonId].name, example: SKELETONS[skeletonId].evidence.examples[0] },
        });

        const [script] = await db
          .insert(remixedScripts)
          .values({
            trendItemId: item.id,
            brandProfileId,
            angle: productType,
            hookType: skeletonId,
            hook: beats[0] ?? null,
            // beats is no longer always exactly 3 (clipCount-driven —
            // could be 1 for a single-artifact remix, 5 for five) — arc/cta
            // are the old fixed 3-slot naming, kept only for whatever still
            // reads them individually; beats itself is the real source of
            // truth for anything that needs all of it.
            arc: beats[1] ?? null,
            cta: beats[beats.length - 1] ?? null,
            slides: beats, // lets the existing Review card render them with no UI change
            beats,
            caption: beats[0],
            // Threading the real product/brand name through the otherwise-unused
            // tags field so the Review card can show it without a schema
            // change or an extra join back to products.
            tags: [productName],
          })
          .returning();

        await db
          .update(trendItems)
          .set({ remixCount: sql`${trendItems.remixCount} + 1`, lastRemixedAt: new Date(), updatedAt: new Date() })
          .where(eq(trendItems.id, item.id));

        const [post] = await db
          .insert(posts)
          .values({
            remixedScriptId: script.id,
            brandProfileId,
            batchId,
            status: "pending",
            // Signals persona-library (or, for manual_viral reels with
            // real artifacts, artifact-based) render on Keep — see the
            // Review page's handleAction, which forwards the matching
            // event name based on this value.
            format,
          })
          .returning();

        results.push({ trendItemId: item.id, productId: productIdForResult, productTitle: productName, skeletonId, scriptId: script.id, postId: post.id });
      }
      return results;
    });

    if (batchId) {
      // Incremented, not overwritten — "Generate 5 more" re-invokes this
      // same function against the same batchId, and an overwrite would
      // lose the count from the run(s) before it.
      await db
        .update(remixBatches)
        .set({
          status: "completed",
          candidatesFound: sql`coalesce(${remixBatches.candidatesFound}, 0) + ${candidates.length}`,
          createdCount: sql`coalesce(${remixBatches.createdCount}, 0) + ${created.length}`,
          completedAt: new Date(),
        })
        .where(eq(remixBatches.id, batchId));
    }

    return { candidatesFound: candidates.length, catalogSize: catalog.length, created: created.length, results: created };
    }
  }
);

/**
 * YouTube discovery — the trending-pull half only (cheap, per
 * needs_deep_dive.md C3). Keyword search (searchShorts) exists in
 * lib/clients/youtube.ts but isn't wired to a trigger yet — it's the
 * quota-constrained path and needs a rationing decision before it's
 * exposed, not just a route.
 */
export const scrapeYoutubeTrendingForBrand = inngest.createFunction(
  { id: "scrape-youtube-trending-for-brand", triggers: { event: "trends/youtube-scrape.requested" } },
  async ({ event, step }) => {
    const { brandProfileId, brandName } = event.data as { brandProfileId: string; brandName: string };

    const rawItems = await step.run("fetch-youtube-trending", async () => {
      return fetchTrendingVideos("IN", "26");
    });

    const upserted = await step.run("upsert-trend-items", async () => {
      const results = [];
      for (const raw of rawItems as RawYoutubeVideo[]) {
        const sourceUrl = `https://www.youtube.com/watch?v=${raw.id}`;
        const viewCount = Number(raw.statistics.viewCount);
        const [row] = await db
          .insert(trendItems)
          .values({
            brandProfileId,
            sourceUrl,
            platform: "youtube",
            title: raw.snippet.title,
            handle: raw.snippet.channelTitle,
            caption: raw.snippet.title,
            durationSeconds: parseIsoDurationSeconds(raw.contentDetails.duration),
            viewCount,
            likeCount: Number(raw.statistics.likeCount),
            commentCount: Number(raw.statistics.commentCount),
            scrapedAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [trendItems.brandProfileId, trendItems.sourceUrl],
            set: {
              prevViewCount: sql`${trendItems.viewCount}`,
              prevScrapedAt: sql`${trendItems.scrapedAt}`,
              viewCount,
              likeCount: Number(raw.statistics.likeCount),
              commentCount: Number(raw.statistics.commentCount),
              scrapedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();
        results.push(row);
      }
      return results;
    });

    const remixed = await step.run("score-and-remix", async () => {
      return scoreAndRemixItems(
        upserted.map((r) => r.id),
        brandName
      );
    });

    return { scraped: rawItems.length, upserted: upserted.length, remixed: remixed.length };
  }
);

/**
 * Real slideshow render job — Remotion, programmatic (lib/render/renderSlideshow.ts),
 * not the CLI. Triggered by event "posts/render.requested" with { postId },
 * which PATCH /api/posts/[id] fires automatically when a post is marked
 * "kept" — matches the product flow (review, then export), no separate
 * "render" button needed.
 */
export const renderSlideshowForPost = inngest.createFunction(
  { id: "render-slideshow-for-post", triggers: { event: "posts/render.requested" } },
  async ({ event, step }) => {
    const { postId } = event.data as { postId: string };

    const context = await step.run("load-post-context", async () => {
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) throw new Error(`Post ${postId} not found`);
      const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
      const [brand] = post.brandProfileId
        ? await db.select().from(brandProfiles).where(eq(brandProfiles.id, post.brandProfileId))
        : [undefined];
      return { post, script, brand };
    });

    const rendered = await step.run("render-video", async () => {
      const { script, brand } = context;
      const buffer = await renderSlideshowVideo({
        slides: script.slides ?? [],
        brandPrimary: brand?.primaryColor ?? "#8a5a2e",
        brandSecondary: brand?.secondaryColor ?? "#4c6b52",
        brandName: brand?.name ?? "",
      });
      const url = await put("rendered-posts", `${postId}.mp4`, buffer);
      await savePosterFrame(postId, buffer);
      return { url, sizeBytes: buffer.length };
    });

    await step.run("update-post", async () => {
      await db
        .update(posts)
        .set({ renderedFileUrl: rendered.url, renderedAt: new Date(), updatedAt: new Date() })
        .where(eq(posts.id, postId));
    });

    return rendered;
  }
);

/**
 * Real per-beat Runway generation — the "build properly" fix for the
 * object-permanence defect found in the single-shot test (a product jar
 * materializing mid-clip with no reach/grab motion). Each beat is generated
 * as its own clip; product-holding beats ("reveal"/"proof"/"button") are
 * anchored via first_frame to the real GloVibe product photo so the model
 * never has to invent how the jar got into frame — see
 * lib/render/runwayPromptTemplates.ts for the reasoning. Triggered by
 * "posts/runway-remix.requested" with { postId }. Not wired to any UI
 * button yet — this is the generation half only, invoked directly for
 * testing before a real paid run.
 */
const BEAT_DURATION_SECONDS: Record<string, number> = {
  setup: 4,
  reveal: 3,
  proof: 3,
  button: 3,
};
const FPS = 30;

export const generateRunwayRemixForPost = inngest.createFunction(
  { id: "generate-runway-remix-for-post", triggers: { event: "posts/runway-remix.requested" } },
  async ({ event, step }) => {
    const { postId } = event.data as { postId: string };

    const context = await step.run("load-post-context", async () => {
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) throw new Error(`Post ${postId} not found`);
      const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
      const [brand] = post.brandProfileId
        ? await db.select().from(brandProfiles).where(eq(brandProfiles.id, post.brandProfileId))
        : [undefined];
      return { post, script, brand };
    });

    const productImageDataUri = await step.run("load-product-image", async () => {
      const buffer = await readFile(path.join(process.cwd(), "..", "productCatalog", "productImage.JPG"));
      return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    });

    const beats: string[] = context.script.beats ?? [];
    const roles = assignBeatRoles(beats);

    // Generation + stitching run inside ONE step: raw clip Buffers can't
    // safely cross a step.run boundary (Inngest serializes step output to
    // JSON for durability, even against the local dev server, which would
    // silently corrupt a Buffer into a plain {type,data} object before the
    // next step read it back).
    const rendered = await step.run("generate-stitch-and-render", async () => {
      const clips: { buffer: Buffer; durationInFrames: number; caption: string }[] = [];
      for (let i = 0; i < beats.length; i++) {
        const role = roles[i];
        const hasProduct = role !== "setup";
        const prompt = buildBeatPrompt({
          role,
          text: beats[i],
          productImageUrl: hasProduct ? productImageDataUri : undefined,
        });
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

      const videoBuffer = await renderRunwayMultiClipVideo({
        postId,
        brandName: context.brand?.name ?? "",
        clips,
      });
      const url = await put("rendered-posts", `${postId}-runway.mp4`, videoBuffer);
      await savePosterFrame(postId, videoBuffer);
      return { url, sizeBytes: videoBuffer.length };
    });

    await step.run("update-post", async () => {
      await db
        .update(posts)
        .set({
          format: "runway_remix",
          renderedFileUrl: rendered.url,
          renderedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));
    });

    return rendered;
  }
);

/**
 * The automation piece: scrape -> score/remix (already real, built earlier)
 * -> beat roles -> persona-library clip lookup -> render, as one real
 * Inngest job, replacing the manual clip-picking done by hand in the
 * Runway fork session (HANDOVER_runway_persona_remix.md's "recommended
 * next steps" #1 and #5). No Runway API call anywhere in this function —
 * every clip is a lookup against pre-built assets (lib/render/personaLibrary.ts),
 * so this costs $0 in generation credits per run, unlike
 * generateRunwayRemixForPost above. Triggered the same way renderSlideshowForPost
 * is — PATCH /api/posts/[id] with status "kept" fires this instead of the
 * slideshow render when the brand's preferred format is persona-library remix.
 */
export const generatePersonaLibraryRemixForPost = inngest.createFunction(
  { id: "generate-persona-library-remix-for-post", triggers: { event: "posts/persona-remix.requested" } },
  async ({ event, step }) => {
    const { postId } = event.data as { postId: string };

    const context = await step.run("load-post-context", async () => {
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) throw new Error(`Post ${postId} not found`);
      const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
      const [brand] = post.brandProfileId
        ? await db.select().from(brandProfiles).where(eq(brandProfiles.id, post.brandProfileId))
        : [undefined];
      return { post, script, brand };
    });

    const rendered = await step.run("assemble-and-render", async () => {
      const beats: string[] = context.script.beats ?? [];
      const roles = assignBeatRoles(beats);

      // One persona for the whole post — mixing faces across a single
      // remix's own beats would look broken. Same honor-an-explicit-pick-
      // first rule as generate-persona/route.ts.
      const persona = (context.script.personaId && getPersonaById(context.script.personaId)) || pickPersona(postId);
      if (!context.script.personaId) {
        await db.update(remixedScripts).set({ personaId: persona.id }).where(eq(remixedScripts.id, context.script.id));
      }
      const clips = roles.map((role, i) => {
        // Seed varies per beat, not just per post, so a single post's 4
        // beats don't all collapse to the same pool index by coincidence.
        const picked = pickPersonaClip(persona, role, `${postId}-${i}`);
        return { ...picked, caption: beats[i] };
      });

      const buffer = await renderPersonaLibraryRemix({ brandName: context.brand?.name ?? "", clips });
      const url = await put("rendered-posts", `${postId}-persona.mp4`, buffer);
      await savePosterFrame(postId, buffer);
      return { url, sizeBytes: buffer.length };
    });

    await step.run("update-post", async () => {
      await db
        .update(posts)
        .set({
          format: "runway_remix",
          renderedFileUrl: rendered.url,
          renderedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));
    });

    return rendered;
  }
);

/**
 * Sibling to generatePersonaLibraryRemixForPost above, for the one case
 * that pipeline can't cover: a manual_viral Viral Trends reel with real
 * admin-uploaded artifacts. Confirmed live this was a genuine gap — the
 * persona pipeline never loads trendItems at all, so an uploaded reaction
 * photo/background clip had zero effect on the finished video regardless
 * of what was uploaded. This loads the trend item specifically to reach
 * its artifacts, turns each uploaded one into a real RunwayClip via
 * lib/render/artifactMedia.ts's prepareArtifactClip (which handles the
 * public/ copy + real ffprobe duration), and renders through the exact
 * same renderPersonaLibraryRemix composition — no new Remotion component
 * needed, it was already generic over any clip list.
 */
export const generateArtifactRemixForPost = inngest.createFunction(
  { id: "generate-artifact-remix-for-post", triggers: { event: "posts/artifact-remix.requested" } },
  async ({ event, step }) => {
    const { postId } = event.data as { postId: string };

    const context = await step.run("load-post-context", async () => {
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) throw new Error(`Post ${postId} not found`);
      const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
      const [brand] = post.brandProfileId
        ? await db.select().from(brandProfiles).where(eq(brandProfiles.id, post.brandProfileId))
        : [undefined];
      const [trendItem] = await db.select().from(trendItems).where(eq(trendItems.id, script.trendItemId));
      return { post, script, brand, trendItem };
    });

    const rendered = await step.run("assemble-and-render", async () => {
      const uploaded = (context.trendItem?.artifacts ?? []).filter((a) => a.status === "uploaded" && a.fileUrl);
      if (uploaded.length === 0) {
        throw new Error(`trend item ${context.trendItem?.id} has no uploaded artifacts — nothing to render`);
      }
      const beats: string[] = context.script.beats ?? [];

      // See generate-artifact-remix/route.ts's identical comment: every
      // beat gets shown somewhere, distributed across whatever real clips
      // exist, played IN SEQUENCE on each clip (not stacked simultaneously).
      const styleResult = context.trendItem
        ? await ensureCaptionStyleAnalyzed(context.trendItem)
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
      const buffer = await renderPersonaLibraryRemix({ brandName: context.brand?.name ?? "", clips });
      const url = await put("rendered-posts", `${postId}-artifact.mp4`, buffer);
      await savePosterFrame(postId, buffer);
      return { url, sizeBytes: buffer.length };
    });

    await step.run("update-post", async () => {
      await db
        .update(posts)
        .set({
          format: "artifact_remix",
          renderedFileUrl: rendered.url,
          renderedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));
    });

    return rendered;
  }
);
