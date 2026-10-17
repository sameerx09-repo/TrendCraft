// One-off local import: the 316-reel research corpus -> trend_items.
//
// No network, no spend — this reads data already paid for and captured in
// scratch/corpus-merged.json (real apify/instagram-search-scraper output,
// popular mode, harvested 2026-08-22).
//
// Deliberately does NOT trigger scoring/remix. 33 items match a skeleton, but
// remix copy still comes from the mock Claude fixture, so auto-remixing would
// stuff the review queue with 33 copies of the same placeholder hook. Import
// populates the library; remix stays a separate, explicit step until
// fillSkeleton is wired into generation.
import { readFileSync } from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "../lib/db/client";
import { trendItems } from "../lib/db/schema";
import { getOrCreateCurrentBrand } from "../lib/db/getOrCreateBrand";
import { extractHook } from "../lib/discovery/extractHook";
import { matchSkeletons } from "../lib/render/skeletonLibrary";

type Raw = Record<string, any>;
const plays = (r: Raw): number | undefined =>
  r.videoPlayCount ?? r.igPlayCount ?? r.videoViewCount ?? undefined;

async function main() {
  const file = path.join(process.cwd(), "scratch", "corpus-merged.json");
  const corpus: Raw[] = JSON.parse(readFileSync(file, "utf-8")).filter(
    (r: Raw) => !r.error && r.url
  );
  const brand = await getOrCreateCurrentBrand();
  console.log(`importing ${corpus.length} reels into brand ${brand.name} (${brand.id})\n`);

  let inserted = 0;
  let matched = 0;
  const bySkeleton: Record<string, number> = {};

  for (const raw of corpus) {
    const hookLine = extractHook(raw.caption);
    const skeletons = matchSkeletons(hookLine);
    if (skeletons.length) {
      matched++;
      for (const s of skeletons) bySkeleton[s] = (bySkeleton[s] ?? 0) + 1;
    }

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
        audioTrackName: raw.musicInfo?.song_name,
        audioId: raw.musicInfo?.audio_id,
        thumbnailUrl: raw.displayUrl,
        postedAt: raw.timestamp ? new Date(raw.timestamp) : undefined,
        durationSeconds: raw.videoDuration,
        viewCount: plays(raw),
        likeCount: raw.likesCount,
        commentCount: raw.commentsCount,
        hookLine,
        matchedSkeletons: skeletons,
        scrapedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trendItems.sourceUrl,
        set: {
          prevViewCount: sql`${trendItems.viewCount}`,
          prevScrapedAt: sql`${trendItems.scrapedAt}`,
          viewCount: plays(raw),
          likeCount: raw.likesCount,
          commentCount: raw.commentsCount,
          caption: raw.caption,
          thumbnailUrl: raw.displayUrl,
          postedAt: raw.timestamp ? new Date(raw.timestamp) : undefined,
          hookLine,
          matchedSkeletons: skeletons,
          updatedAt: new Date(),
        },
      });
    inserted++;
    if (inserted % 50 === 0) console.log(`  ${inserted}/${corpus.length}`);
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(trendItems);

  console.log(`\nupserted: ${inserted}`);
  console.log(`skeleton-matched: ${matched}`);
  for (const [k, v] of Object.entries(bySkeleton).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(18)} ${v}`);
  }
  console.log(`\ntrend_items total now: ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
