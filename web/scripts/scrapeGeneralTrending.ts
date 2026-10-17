// Real, deliberate test: general-virality discovery (broad, non-niche
// hashtags) instead of brand-hashtag-scoped, per the "borrow the vibe, not
// the niche" brainstorm. Scrapes + upserts into trend_items (the real
// Content Library) directly — skips the auto score-and-remix chain
// on purpose, since these are getting a real hand-customized GloVibe pass
// afterward, not the generic mock-fixture remix.
import { readFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}
process.env.MOCK_MODE = "false";

import { scrapeInstagramReels } from "../lib/clients/apify";
import { db } from "../lib/db/client";
import { trendItems } from "../lib/db/schema";
import { getOrCreateCurrentBrand } from "../lib/db/getOrCreateBrand";
import { sql } from "drizzle-orm";

async function main() {
  const brand = await getOrCreateCurrentBrand();

  // Broad/general tags, deliberately NOT skincare-scoped — the whole point
  // of this test.
  const items = await scrapeInstagramReels(["viral", "trending", "reelsindia"], 2);

  console.log(`Scraped ${items.length} items\n`);

  for (const raw of items) {
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
        scrapedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trendItems.sourceUrl,
        set: {
          prevViewCount: sql`${trendItems.viewCount}`,
          prevScrapedAt: sql`${trendItems.scrapedAt}`,
          viewCount: raw.videoPlayCount ?? raw.igPlayCount,
          updatedAt: new Date(),
        },
      })
      .returning();

    console.log(`- [${row.id}] @${raw.ownerUsername} (${raw.videoPlayCount ?? raw.igPlayCount} plays)`);
    console.log(`  ${raw.caption?.slice(0, 140).replace(/\n/g, " ")}...`);
    console.log(`  videoUrl: ${raw.videoUrl}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
