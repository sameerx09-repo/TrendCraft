// REAL SPEND — targeted corpus growth.
//
// `advice` was the only keyword whose hook lines were consistently structural
// ("A perfumer told me this...", "My hairdresser told me this secret").
// `motivation` had 5x the views and produced junk. So: sweep the advice/hack
// family rather than chasing volume.
//
// Hook extraction rule (found the cheap way, after over-engineering it):
// the hook is the caption text BEFORE the first hashtag. No OCR, no transcript.
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error("APIFY_TOKEN missing");

const KEYWORDS = ["lifehack", "beauty hack", "cleaning hack", "kitchen hack", "hair hack", "home hack"];
const LIMIT = 40;

type Raw = Record<string, unknown>;
const plays = (r: Raw) =>
  (r.videoPlayCount as number) ?? (r.igPlayCount as number) ?? (r.videoViewCount as number) ?? 0;

export function extractHook(caption?: string): string {
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
  console.log(`Keywords: ${KEYWORDS.join(", ")}`);
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

  const outPath = path.join(process.cwd(), "scratch", "advice-hooks-raw.json");
  writeFileSync(outPath, JSON.stringify(items, null, 2));

  const errs = items.filter((r) => r.error);
  const ok = items.filter((r) => !r.error);
  console.log(`${items.length} items (${ok.length} ok, ${errs.length} errors) -> scratch/advice-hooks-raw.json\n`);
  for (const e of errs) console.log(`  EMPTY: ${String(e.inputUrl).split("/").pop()}`);

  // merge with the earlier popular-reels corpus so clustering has more to work with
  const prevPath = path.join(process.cwd(), "scratch", "popular-reels-raw.json");
  const prev: Raw[] = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf-8")) : [];
  const seen = new Set<string>();
  const merged = [...ok, ...prev.filter((r) => !r.error)].filter((r) => {
    const u = String(r.url ?? "");
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  writeFileSync(
    path.join(process.cwd(), "scratch", "corpus-merged.json"),
    JSON.stringify(merged, null, 2)
  );
  console.log(`\nmerged corpus: ${merged.length} unique reels -> scratch/corpus-merged.json\n`);

  const hooks = ok
    .map((r) => ({
      hook: extractHook(r.caption as string),
      plays: plays(r),
      user: r.ownerUsername as string,
      kw: String(r.inputUrl ?? "").replace(/\/$/, "").split("/").pop(),
    }))
    .filter((h) => h.hook.length >= 12 && h.hook.length <= 130)
    .sort((a, b) => b.plays - a.plays);

  console.log("=".repeat(78));
  console.log(`HOOK LINES (${hooks.length} usable)`);
  console.log("=".repeat(78));
  for (const h of hooks.slice(0, 45)) {
    console.log(`${h.plays.toString().padStart(11)} [${(h.kw ?? "").slice(0, 8).padEnd(8)}] ${h.hook}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
