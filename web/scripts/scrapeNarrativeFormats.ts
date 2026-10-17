// Follow-up to scrapeGeneralTrending.ts: raw popularity tags (viral/trending)
// surfaced spam/meme/repost content, not narrative-driven reels. This run
// targets format/category tags instead — the actual signal for "borrowable
// hook->arc->beat structure" is content category, not popularity.
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

  const items = await scrapeInstagramReels(["storytime", "grwm", "dayinmylife", "relatable"], 2);

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

    console.log(`- [${row.id}] @${raw.ownerUsername} (${raw.videoPlayCount ?? raw.igPlayCount} plays, ${raw.videoDuration}s)`);
    console.log(`  ${raw.caption?.slice(0, 200).replace(/\n/g, " ")}`);
    console.log(`  videoUrl: ${raw.videoUrl}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
