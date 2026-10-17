import { db } from "@/lib/db/client";
import { trendItems, products } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { fetchShopifyProducts, stripHtml, type RawShopifyProduct } from "@/lib/clients/productCatalog";
import { generateProductSlotValues } from "@/lib/clients/productCopywriter";
import { scrapeInstagramReels, type RawApifyReelItem } from "@/lib/clients/apify";
import { fetchTrendingVideos, parseIsoDurationSeconds, type RawYoutubeVideo } from "@/lib/clients/youtube";
import { extractHook } from "@/lib/discovery/extractHook";
import { matchSkeletons } from "@/lib/render/skeletonLibrary";
import { scoreAndRemixItems } from "@/lib/inngest/functions";
import { eq, and, isNull, sql } from "drizzle-orm";

/**
 * Real step-by-step pipeline progress — the Riff mock's "WORKING ON
 * GLO-VIBE.COM" onboarding screen. Every OTHER trigger in this app
 * (Refresh trends, Remix from skeletons) fires an Inngest event and
 * returns immediately — the actual work happens async in a separate
 * process with no channel back to the browser, so the frontend can only
 * poll and guess. That's fine for a button click, but the whole point of
 * this screen is showing real progress as it happens, which needs the
 * work to run IN this request. So this route calls the same underlying
 * functions the Inngest handlers call (lib/clients/*, scoreAndRemixItems)
 * directly — same pattern scripts/buildComparisons.ts already uses
 * successfully — and streams newline-delimited JSON as each step
 * completes, with real counts, not simulated ones.
 *
 * "Rendering video" is deliberately NOT a real step here — rendering one
 * video takes ~90s, and this pipeline can produce a dozen posts, so eagerly
 * rendering all of them synchronously would make this request take many
 * minutes for no product reason: this app's real architecture renders one
 * video at a time, on Keep, after a human reviews it (see /api/posts/[id]
 * PATCH). Reporting a fake bulk-render step here would misrepresent how
 * the product actually works, so this ends at "ready to review" instead.
 */
export const maxDuration = 120;

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(obj: unknown) {
        controller.enqueue(encoder.encode(line(obj)));
      }

      try {
        const brand = await getOrCreateCurrentBrand();

        // 1. Reading the site
        emit({ step: "reading", status: "active" });
        const rawProducts = await fetchShopifyProducts(brand.domain);
        const productRows = [];
        for (const raw of rawProducts as RawShopifyProduct[]) {
          const [row] = await db
            .insert(products)
            .values({
              brandProfileId: brand.id,
              externalId: String(raw.id),
              handle: raw.handle,
              title: raw.title,
              productType: raw.product_type || null,
              description: raw.body_html ? stripHtml(raw.body_html) : null,
              imageUrl: raw.images?.[0]?.src ?? null,
              price: raw.variants?.[0]?.price ?? null,
              sourceUrl: `https://${brand.domain}/products/${raw.handle}`,
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
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .returning();
          productRows.push(row);
        }
        const angleCount = new Set(productRows.map((p) => p.productType).filter(Boolean)).size;
        emit({
          step: "reading",
          status: "done",
          detail: `${productRows.length} products, ${angleCount} angles`,
        });

        // Copy generation — only for products that don't have it yet, same
        // guard generateProductCopyForBrand uses, so re-running onboarding
        // doesn't re-pay for products already covered.
        const pendingCopy = productRows.filter((p) => !p.slotValues);
        for (const product of pendingCopy) {
          const slotValues = await generateProductSlotValues({
            title: product.title,
            productType: product.productType,
            description: product.description,
          });
          await db.update(products).set({ slotValues, updatedAt: new Date() }).where(eq(products.id, product.id));
        }

        // 2. Scouting Instagram
        emit({ step: "instagram", status: "active" });
        const hashtags = brand.hashtags ?? [];
        let igUpserted: { id: string; matched: boolean }[] = [];
        if (hashtags.length > 0) {
          const rawReels = (await scrapeInstagramReels(hashtags, 10)) as RawApifyReelItem[];
          for (const raw of rawReels) {
            const hookLine = extractHook(raw.caption);
            const matched = matchSkeletons(hookLine);
            const [row] = await db
              .insert(trendItems)
              .values({
                brandProfileId: brand.id,
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
            igUpserted.push({ id: row.id, matched: matched.length > 0 });
          }
        }
        emit({
          step: "instagram",
          status: "done",
          detail:
            hashtags.length > 0
              ? `${igUpserted.length} reels across ${hashtags.length} hashtags`
              : "skipped — no hashtags set on Brand Profile",
        });

        // 3. Scouting YouTube Shorts
        emit({ step: "youtube", status: "active" });
        const rawVideos = (await fetchTrendingVideos("IN", "26")) as RawYoutubeVideo[];
        const shortVideos = rawVideos.filter((v) => parseIsoDurationSeconds(v.contentDetails.duration) <= 180);
        const ytUpserted: { id: string; matched: boolean }[] = [];
        for (const raw of shortVideos) {
          const sourceUrl = `https://www.youtube.com/watch?v=${raw.id}`;
          const hookLine = extractHook(raw.snippet.title);
          const matched = matchSkeletons(hookLine);
          const [row] = await db
            .insert(trendItems)
            .values({
              brandProfileId: brand.id,
              sourceUrl,
              platform: "youtube",
              title: raw.snippet.title,
              handle: raw.snippet.channelTitle,
              caption: raw.snippet.title,
              hookLine,
              matchedSkeletons: matched,
              durationSeconds: parseIsoDurationSeconds(raw.contentDetails.duration),
              viewCount: Number(raw.statistics.viewCount),
              likeCount: Number(raw.statistics.likeCount),
              commentCount: Number(raw.statistics.commentCount),
              scrapedAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [trendItems.brandProfileId, trendItems.sourceUrl],
              set: {
                prevViewCount: sql`${trendItems.viewCount}`,
                viewCount: Number(raw.statistics.viewCount),
                likeCount: Number(raw.statistics.likeCount),
                commentCount: Number(raw.statistics.commentCount),
                hookLine,
                matchedSkeletons: matched,
                scrapedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .returning();
          ytUpserted.push({ id: row.id, matched: matched.length > 0 });
        }
        emit({
          step: "youtube",
          status: "done",
          detail: `${shortVideos.length} shorts after the ≤180s filter (${rawVideos.length} trending pulled)`,
        });

        // 4. Scoring relevance + rewriting for brand — one real combined
        // step in this codebase (scoreAndRemix returns both together per
        // item), not two separable phases — reported as such rather than
        // faking a sequential split that doesn't match how it actually runs.
        emit({ step: "scoring", status: "active" });
        const matchedIds = [...igUpserted, ...ytUpserted].filter((r) => r.matched).map((r) => r.id);
        const remixed = matchedIds.length > 0 ? await scoreAndRemixItems(matchedIds, brand.name) : [];
        emit({
          step: "scoring",
          status: "done",
          detail: `${remixed.length} strong matches remixed, from ${igUpserted.length + ytUpserted.length} scraped`,
        });

        emit({ step: "done", status: "done", detail: `${remixed.length} posts ready to review` });
      } catch (e) {
        emit({ step: "error", status: "error", detail: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
