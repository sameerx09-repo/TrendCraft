// Consolidated, direct-to-DB rebuild for #4 (original-vs-remix comparisons).
//
// WHY THIS EXISTS: every PGlite corruption this session (4x) happened while
// operations went through the Next.js dev server's HTTP/Inngest layer under
// load. Standalone tsx scripts calling the same DB/lib functions directly
// have never once corrupted it, across three separate rebuilds. This script
// does all the heavy DB work (import, product sync, copy, skeleton remix,
// render, real video download) in one direct process, bypassing the server
// entirely, and leaves the server only for final read-only verification.
import { readFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// MOCK_MODE stays true for everything except the one real step at the end
// (fetchOriginalReelVideo), which flips it in-process only — .env.local
// itself is never touched, same pattern as scrapeNewReel.ts earlier this
// session.
process.env.MOCK_MODE = "true";

import { db } from "../lib/db/client";
import { trendItems, products, remixedScripts, posts } from "../lib/db/schema";
import { getOrCreateCurrentBrand } from "../lib/db/getOrCreateBrand";
import { extractHook } from "../lib/discovery/extractHook";
import { matchSkeletons, fillSkeleton, type SkeletonId } from "../lib/render/skeletonLibrary";
import { fetchShopifyProducts, stripHtml } from "../lib/clients/productCatalog";
import { generateProductSlotValues } from "../lib/clients/productCopywriter";
import { fetchOriginalReelVideo } from "../lib/clients/apify";
import { pickPersona, pickPersonaClip } from "../lib/render/personaLibrary";
import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { put } from "../lib/storage";
import { eq, and, sql, isNull } from "drizzle-orm";

const BRAND_AUTHORITY = "A dermatologist";
const BRAND_AGE = "30";

async function main() {
  const brand = await getOrCreateCurrentBrand();
  console.log(`brand: ${brand.name} (${brand.id})\n`);

  // 1. import the real 316-reel corpus
  console.log("1. importing research corpus...");
  const corpus: any[] = JSON.parse(readFileSync(path.join(__dirname, "..", "scratch", "corpus-merged.json"), "utf-8")).filter(
    (r: any) => !r.error && r.url
  );
  for (const raw of corpus) {
    const hookLine = extractHook(raw.caption);
    const skeletons = matchSkeletons(hookLine);
    await db
      .insert(trendItems)
      .values({
        brandProfileId: brand.id,
        sourceUrl: raw.url,
        platform: "instagram",
        title: raw.caption,
        handle: raw.ownerUsername,
        caption: raw.caption,
        hashtags: raw.hashtags,
        durationSeconds: raw.videoDuration,
        viewCount: raw.videoPlayCount ?? raw.igPlayCount,
        likeCount: raw.likesCount,
        commentCount: raw.commentsCount,
        hookLine,
        matchedSkeletons: skeletons,
        scrapedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trendItems.sourceUrl,
        set: { hookLine, matchedSkeletons: skeletons, updatedAt: new Date() },
      });
  }
  console.log(`   ${corpus.length} reels imported\n`);

  // 2. sync real product catalog (free — public Shopify JSON)
  console.log("2. syncing product catalog...");
  const rawProducts = await fetchShopifyProducts(brand.domain);
  for (const raw of rawProducts) {
    await db
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
        target: products.sourceUrl,
        set: {
          title: raw.title,
          description: raw.body_html ? stripHtml(raw.body_html) : null,
          imageUrl: raw.images?.[0]?.src ?? null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
  console.log(`   ${rawProducts.length} products synced\n`);

  // 3. generate copy — mock mode, real fixture values, free
  console.log("3. generating product copy (mock, from real fixture)...");
  const catalog = await db.select().from(products).where(eq(products.brandProfileId, brand.id));
  for (const product of catalog) {
    if (product.slotValues) continue;
    const slotValues = await generateProductSlotValues({
      title: product.title,
      productType: product.productType,
      description: product.description,
    });
    await db.update(products).set({ slotValues, updatedAt: new Date() }).where(eq(products.id, product.id));
  }
  console.log(`   done\n`);

  // 4. select skeleton-matched candidates, map to products, fill, create posts
  console.log("4. mapping skeleton-matched reels to products...");
  const candidates = await db
    .select()
    .from(trendItems)
    .where(
      and(
        eq(trendItems.brandProfileId, brand.id),
        sql`jsonb_array_length(${trendItems.matchedSkeletons}) > 0`,
        eq(trendItems.remixCount, 0)
      )
    )
    .orderBy(sql`coalesce(${trendItems.viewCount}, 0) desc`)
    .limit(8);

  const freshCatalog = await db.select().from(products).where(eq(products.brandProfileId, brand.id));
  const createdPostIds: string[] = [];
  let cursor = 0;
  for (const item of candidates) {
    const skeletonId = (item.matchedSkeletons as SkeletonId[])[0];
    const product = freshCatalog[cursor % freshCatalog.length];
    cursor++;
    if (!product.slotValues) continue;

    const filled = fillSkeleton(skeletonId, {
      authority: BRAND_AUTHORITY,
      age: BRAND_AGE,
      product: product.title,
      ...(product.slotValues as Record<string, string>),
    });
    const beats = filled.map((b) => b.caption);

    const [script] = await db
      .insert(remixedScripts)
      .values({
        trendItemId: item.id,
        brandProfileId: brand.id,
        angle: product.productType,
        hookType: skeletonId,
        hook: beats[0],
        arc: beats[1],
        cta: beats[2],
        slides: beats,
        beats,
        caption: beats[0],
        tags: [product.title],
      })
      .returning();

    await db
      .update(trendItems)
      .set({ remixCount: sql`${trendItems.remixCount} + 1`, lastRemixedAt: new Date() })
      .where(eq(trendItems.id, item.id));

    const [post] = await db
      .insert(posts)
      .values({ remixedScriptId: script.id, brandProfileId: brand.id, status: "pending", format: "runway_remix" })
      .returning();

    createdPostIds.push(post.id);
    console.log(`   ${skeletonId} -> ${product.title}`);
  }
  console.log(`   ${createdPostIds.length} posts created\n`);

  // 5. keep + render 5 of them directly (proven-reliable render path, no Inngest/HTTP)
  console.log("5. rendering 5 remixes directly...");
  const toRender = createdPostIds.slice(0, 5);
  const renderedTrendItemIds: string[] = [];
  for (const postId of toRender) {
    const [post] = await db.select().from(posts).where(eq(posts.id, postId));
    const [script] = await db.select().from(remixedScripts).where(eq(remixedScripts.id, post.remixedScriptId));
    const beats: string[] = script.beats ?? [];
    const roles: ("setup" | "reveal" | "button")[] = ["setup", "reveal", "button"];
    const persona = pickPersona(postId);
    const clips = roles.map((role, i) => ({ ...pickPersonaClip(persona, role, `${postId}-${i}`), caption: beats[i] }));

    const buffer = await renderPersonaLibraryRemix({ brandName: brand.name, clips });
    const url = await put("rendered-posts", `${postId}-persona.mp4`, buffer);

    await db
      .update(posts)
      .set({ status: "kept", renderedFileUrl: url, renderedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, postId));

    renderedTrendItemIds.push(script.trendItemId);
    console.log(`   rendered ${postId} (${buffer.length.toLocaleString()} bytes)`);
  }
  console.log();

  // 6. THE REAL SPEND STEP — download real original videos, in-process mock flip
  console.log("6. downloading real original videos (REAL Apify spend, ~$0.075/reel)...");
  process.env.MOCK_MODE = "false";
  for (const trendItemId of renderedTrendItemIds) {
    const [item] = await db.select().from(trendItems).where(eq(trendItems.id, trendItemId));
    if (item.sourceVideoUrl) {
      console.log(`   skip (already downloaded): ${item.handle}`);
      continue;
    }
    try {
      const result = await fetchOriginalReelVideo(item.sourceUrl);
      const url = await put("source-videos", `${item.id}.mp4`, result.buffer);
      await db
        .update(trendItems)
        .set({ sourceVideoUrl: url, sourceVideoDownloadedAt: new Date(), updatedAt: new Date() })
        .where(eq(trendItems.id, item.id));
      console.log(`   downloaded @${item.handle} (${buffer.length.toLocaleString()} bytes)`);
    } catch (e) {
      console.error(`   FAILED @${item.handle}:`, e instanceof Error ? e.message : e);
    }
  }
  process.env.MOCK_MODE = "true";

  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
