// REAL SPEND — evaluation run, not production.
//
// Tests apify/instagram-search-scraper in `popular` mode (popularity-ranked)
// against our current instagram-hashtag-scraper baseline (recency-ranked).
// Hypothesis: most of our bad yield came from sampling the RECENT tail of a
// hashtag rather than the VIRAL head of a topic.
//
// Input schema verified against the live actor build schema before running
// (search / searchType / searchLimit), not guessed.
//
// Writes raw results to scratch/ for analysis. Does NOT insert into the DB —
// this is a yield-quality experiment, and mixing unvetted candidates into the
// real content library would pollute the baseline we're measuring against.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error("APIFY_TOKEN missing from .env.local");

// Broad, non-brand keywords biased toward text-carrier / low-prop formats.
const KEYWORDS = ["relatable", "storytime", "motivation", "advice", "pov", "confession"];
const LIMIT_PER_KEYWORD = 50;

interface PopularReel {
  url?: string;
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  mentions?: string[];
  videoUrl?: string;
  videoDuration?: number;
  duration?: number;
  timestamp?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  likesCount?: number;
  commentsCount?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
  igPlayCount?: number;
  isSponsored?: boolean;
  paidPartnership?: boolean;
  coauthors?: unknown[];
  taggedUsers?: unknown[];
  musicInfo?: Record<string, unknown>;
  [k: string]: unknown;
}

function plays(r: PopularReel): number {
  return r.videoPlayCount ?? r.igPlayCount ?? r.videoViewCount ?? 0;
}

function seconds(r: PopularReel): number {
  return r.videoDuration ?? r.duration ?? 0;
}

/**
 * Stage-1 metadata-only screen from the remixability rubric. Deliberately
 * cheap: no video download, no vision model. Flags reasons for rejection so
 * we can see WHY the yield is what it is, not just a pass/fail count.
 */
function stage1(r: PopularReel): string[] {
  const blockers: string[] = [];
  const dur = seconds(r);
  if (dur && (dur < 5 || dur > 45)) blockers.push(`duration:${dur.toFixed(0)}s`);
  if (r.paidPartnership || r.isSponsored) blockers.push("sponsored");
  if ((r.mentions?.length ?? 0) > 0) blockers.push(`mentions:${r.mentions!.length}`);
  if ((r.coauthors?.length ?? 0) > 0) blockers.push("coauthored");
  if (plays(r) < 10000) blockers.push(`lowplays:${plays(r)}`);
  return blockers;
}

async function run() {
  console.log(`Keywords: ${KEYWORDS.join(", ")}`);
  console.log(`Limit: ${LIMIT_PER_KEYWORD}/keyword — max ${KEYWORDS.length * LIMIT_PER_KEYWORD} results\n`);

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-search-scraper/run-sync-get-dataset-items?token=${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search: KEYWORDS.join(","),
        searchType: "popular",
        searchLimit: LIMIT_PER_KEYWORD,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  const items: PopularReel[] = await res.json();
  const outDir = path.join(process.cwd(), "scratch");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "popular-reels-raw.json"), JSON.stringify(items, null, 2));

  console.log(`Returned ${items.length} items -> scratch/popular-reels-raw.json\n`);
  if (!items.length) return;

  console.log(`Field keys on first item:\n  ${Object.keys(items[0]).join(", ")}\n`);

  const passed = items.filter((r) => stage1(r).length === 0);
  console.log(`Stage-1 pass: ${passed.length}/${items.length} (${((passed.length / items.length) * 100).toFixed(0)}%)\n`);

  const sorted = [...items].sort((a, b) => plays(b) - plays(a));
  console.log("=== Top 15 by plays ===");
  for (const r of sorted.slice(0, 15)) {
    const blockers = stage1(r);
    console.log(
      `${blockers.length ? "REJECT" : "  PASS"} | ${plays(r).toLocaleString().padStart(10)} plays | ${seconds(r).toFixed(0).padStart(3)}s | @${r.ownerUsername ?? "?"}`
    );
    console.log(`         ${(r.caption ?? "").slice(0, 110).replace(/\s+/g, " ")}`);
    if (blockers.length) console.log(`         blockers: ${blockers.join(", ")}`);
    console.log(`         ${r.url ?? ""}`);
  }

  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`\nMedian plays: ${plays(median).toLocaleString()}`);
  console.log(`Max plays:    ${plays(sorted[0]).toLocaleString()}`);
  console.log(`Min plays:    ${plays(sorted[sorted.length - 1]).toLocaleString()}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
