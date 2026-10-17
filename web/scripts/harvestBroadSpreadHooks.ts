// REAL SPEND — broad cross-niche corpus growth, to test whether the 5
// existing skeletons (mined from a skincare-adjacent corpus) actually
// generalize across verticals, and whether the persona library's 6 generic
// clip expressions cover the emotional range those skeletons need.
// Metadata-only (popular-mode search, no video download) — same actor/mode
// as scripts/harvestAdviceHooks.ts, just wider keyword coverage.
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error("APIFY_TOKEN missing");

// Existing advice/hack family (kept for corpus continuity) + one keyword per
// new vertical, so the spread is genuinely cross-niche rather than more
// beauty/home-adjacent volume.
const KEYWORDS = [
  "advice",
  "beauty hack",
  "cleaning hack",
  "kitchen hack",
  "hair hack",
  "home hack",
  "style hack",
  "cooking hack",
  "fitness hack",
  "money hack",
  "parenting hack",
  "tech hack",
];
const LIMIT = 40;

type Raw = Record<string, unknown>;
const plays = (r: Raw) =>
  (r.videoPlayCount as number) ?? (r.igPlayCount as number) ?? (r.videoViewCount as number) ?? 0;

function extractHook(caption?: string): string {
  if (!caption) return "";
  return caption
    .split("#")[0]
    .replace(/@[\w.]+/g, " ")
    // Emoji/pictographs only — NOT a blanket non-ASCII strip, which used to
    // delete non-Latin scripts entirely (see lib/discovery/extractHook.ts).
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[‍️]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const { matchSkeletons, SKELETONS } = await import("../lib/render/skeletonLibrary");

  console.log(`Keywords (${KEYWORDS.length}): ${KEYWORDS.join(", ")}`);
  console.log(`Limit ${LIMIT}/kw — max ${KEYWORDS.length * LIMIT} results\n`);

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-search-scraper/run-sync-get-dataset-items?token=${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: KEYWORDS.join(","), searchType: "popular", searchLimit: LIMIT }),
    }
  );
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const items: Raw[] = await res.json();

  const outPath = path.join(process.cwd(), "scratch", "broad-spread-raw.json");
  writeFileSync(outPath, JSON.stringify(items, null, 2));

  const errs = items.filter((r) => r.error);
  const ok = items.filter((r) => !r.error);
  console.log(`${items.length} items (${ok.length} ok, ${errs.length} errors) -> scratch/broad-spread-raw.json\n`);
  for (const e of errs) console.log(`  EMPTY: ${String(e.inputUrl).split("/").pop()}`);

  // merge into the existing corpus so future harvests keep compounding
  const prevPath = path.join(process.cwd(), "scratch", "corpus-merged.json");
  const prev: Raw[] = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf-8")) : [];
  const seen = new Set<string>();
  const merged = [...ok, ...prev.filter((r) => !r.error)].filter((r) => {
    const u = String(r.url ?? "");
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  writeFileSync(path.join(process.cwd(), "scratch", "corpus-merged.json"), JSON.stringify(merged, null, 2));
  console.log(`merged corpus: ${merged.length} unique reels -> scratch/corpus-merged.json\n`);

  const hooks = ok
    .map((r) => ({
      hook: extractHook(r.caption as string),
      plays: plays(r),
      user: r.ownerUsername as string,
      kw: String(r.inputUrl ?? "").replace(/\/$/, "").split("/").pop(),
    }))
    .filter((h) => h.hook.length >= 12 && h.hook.length <= 130)
    .sort((a, b) => b.plays - a.plays);

  const matched = hooks.map((h) => ({ ...h, skeletons: matchSkeletons(h.hook) }));
  const isMatched = matched.filter((h) => h.skeletons.length > 0);
  const unmatched = matched.filter((h) => h.skeletons.length === 0);

  console.log("=".repeat(78));
  console.log(`EXISTING SKELETON HITS ACROSS THE NEW BROAD-SPREAD BATCH (${isMatched.length}/${matched.length} hooks matched)`);
  console.log("=".repeat(78));
  const perSkeleton: Record<string, { count: number; keywords: Set<string> }> = {};
  for (const h of isMatched) {
    for (const s of h.skeletons) {
      perSkeleton[s] ??= { count: 0, keywords: new Set() };
      perSkeleton[s].count++;
      if (h.kw) perSkeleton[s].keywords.add(h.kw);
    }
  }
  for (const [id, data] of Object.entries(perSkeleton).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${id}: ${data.count} new instances, across keywords: ${[...data.keywords].join(", ")}`);
  }

  console.log("\n" + "=".repeat(78));
  console.log(`TOP UNMATCHED HIGH-PLAY HOOKS (${unmatched.length} total) — candidate new skeletons`);
  console.log("=".repeat(78));
  for (const h of unmatched.slice(0, 40)) {
    console.log(`${h.plays.toString().padStart(11)} [${(h.kw ?? "").slice(0, 10).padEnd(10)}] ${h.hook}`);
  }

  console.log("\nKnown skeleton names for reference:");
  for (const id of Object.keys(SKELETONS)) console.log(`  ${id}: ${SKELETONS[id as keyof typeof SKELETONS].name}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
