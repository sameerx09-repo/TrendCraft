// Free, no-spend re-check: re-runs the FIXED extractHook + matchSkeletons
// against the already-scraped corpus to measure how many reels were
// affected by the non-ASCII-strip bug, and how many now match a skeleton
// that previously couldn't.
import { readFileSync } from "fs";
import path from "path";

async function main() {
  const { extractHook, isUsableHook } = await import("../lib/discovery/extractHook");
  const { matchSkeletons } = await import("../lib/render/skeletonLibrary");

  const corpus: any[] = JSON.parse(
    readFileSync(path.join(process.cwd(), "scratch", "corpus-merged.json"), "utf-8")
  ).filter((r: any) => !r.error && r.url);

  // OLD (buggy) extractor, inlined for comparison only.
  function oldExtractHook(caption?: string): string {
    if (!caption) return "";
    return caption
      .split("#")[0]
      .replace(/@[\w.]+/g, " ")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  let nonAsciiCaptions = 0;
  let newlyUsable = 0;
  let newlyMatched = 0;
  const newMatches: { user: string; hook: string; skeletons: string[]; plays: number }[] = [];

  for (const r of corpus) {
    const caption = r.caption as string | undefined;
    if (!caption || !/[^\x00-\x7f]/.test(caption.split("#")[0])) continue; // only care about non-ASCII captions
    nonAsciiCaptions++;

    const oldHook = oldExtractHook(caption);
    const newHook = extractHook(caption);
    if (oldHook === newHook) continue;

    const oldUsable = isUsableHook(oldHook);
    const newUsable = isUsableHook(newHook);
    if (newUsable && !oldUsable) newlyUsable++;

    if (newUsable) {
      const skeletons = matchSkeletons(newHook);
      if (skeletons.length > 0) {
        newlyMatched++;
        newMatches.push({
          user: r.ownerUsername,
          hook: newHook,
          skeletons,
          plays: r.videoPlayCount ?? r.igPlayCount ?? 0,
        });
      }
    }
  }

  console.log(`Corpus size: ${corpus.length}`);
  console.log(`Reels with non-ASCII caption text: ${nonAsciiCaptions}`);
  console.log(`Newly usable-length hooks after the fix: ${newlyUsable}`);
  console.log(`Newly skeleton-matched after the fix: ${newlyMatched}\n`);

  if (newMatches.length) {
    console.log("New matches:");
    newMatches
      .sort((a, b) => b.plays - a.plays)
      .forEach((m) => console.log(`  ${m.plays.toLocaleString().padStart(12)} @${m.user} [${m.skeletons.join(",")}] ${m.hook}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
