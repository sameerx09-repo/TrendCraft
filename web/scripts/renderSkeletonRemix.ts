// Closes the loop: real scraped corpus -> mined skeleton -> GloVibe remix,
// rendered with $0 marginal cost from the existing persona library.
//
// Runs a regression check of the library's matchers against the real 311-reel
// corpus first. If a matcher stops finding the instances it was derived from,
// the library is broken and the render is meaningless — so it fails loudly
// rather than rendering something built on a silently-broken matcher.
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { extractHook, isUsableHook } from "../lib/discovery/extractHook";
import { SKELETONS, fillSkeleton, matchSkeletons, type SkeletonId } from "../lib/render/skeletonLibrary";
import { pickPersona, pickPersonaClip } from "../lib/render/personaLibrary";
import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

type Raw = Record<string, unknown>;
const plays = (r: Raw) =>
  (r.videoPlayCount as number) ?? (r.igPlayCount as number) ?? (r.videoViewCount as number) ?? 0;

function validateAgainstCorpus() {
  const p = path.join(process.cwd(), "scratch", "corpus-merged.json");
  if (!existsSync(p)) {
    console.log("(corpus not present — skipping matcher regression check)\n");
    return;
  }
  const corpus: Raw[] = JSON.parse(readFileSync(p, "utf-8")).filter((r: Raw) => !r.error);
  const hooks = corpus
    .map((r) => ({ hook: extractHook(r.caption as string), plays: plays(r) }))
    .filter((h) => isUsableHook(h.hook));

  console.log(`matcher regression: ${hooks.length} usable hooks from ${corpus.length} reels`);
  const tally: Record<string, { n: number; plays: number }> = {};
  for (const h of hooks) {
    for (const id of matchSkeletons(h.hook)) {
      tally[id] ??= { n: 0, plays: 0 };
      tally[id].n++;
      tally[id].plays += h.plays;
    }
  }
  let broken = false;
  for (const id of Object.keys(SKELETONS) as SkeletonId[]) {
    const got = tally[id]?.n ?? 0;
    const expected = SKELETONS[id].evidence.instances;
    const ok = got >= Math.floor(expected * 0.7); // matcher may be stricter than the hand count
    if (!ok) broken = true;
    console.log(
      `  ${ok ? "ok " : "FAIL"} ${id.padEnd(18)} matched ${String(got).padStart(3)} (recorded ${expected})  ${(tally[id]?.plays ?? 0).toLocaleString()} plays`
    );
  }
  if (broken) throw new Error("matcher regression failed — library and corpus disagree");
  console.log();
}

async function main() {
  validateAgainstCorpus();

  const SKELETON: SkeletonId = "authority_secret";
  const sk = SKELETONS[SKELETON];
  console.log(`skeleton: ${sk.name}`);
  console.log(`evidence: ${sk.evidence.instances} instances, ${sk.evidence.creators} creators, ${sk.evidence.totalPlays.toLocaleString()} plays\n`);

  const filled = fillSkeleton(SKELETON, {
    authority: "A dermatologist",
    payoff: "My skin has never been this calm.",
    product: "Kumkumadi Night Renewal Cream",
  });

  const seed = "glovibe-skeleton-a";
  const persona = pickPersona(seed);
  const clips: RunwayClip[] = filled.map((beat) => ({
    ...pickPersonaClip(persona, beat.role, seed),
    caption: beat.caption,
  }));

  console.log("beats:");
  filled.forEach((b, i) => console.log(`  ${b.role.padEnd(7)} ${clips[i].durationInFrames}f  "${b.caption}"`));

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const out = path.join(process.cwd(), "out", "glovibe-skeleton-authority.mp4");
  writeFileSync(out, buffer);
  console.log(`\nrendered: ${out} (${buffer.length.toLocaleString()} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
