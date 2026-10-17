import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { writeFile } from "fs/promises";
import path from "path";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

/**
 * One-off recreation, not a DB-backed post — reconstructs the real 3-beat
 * structure of the existing reelA-glovibe-remix.mp4 (captions recovered by
 * re-inspecting the actual output frames, not re-invented), through the
 * current render pipeline with the caption-position fix applied. The
 * original file used priya-hook.mp4 for the hook beat and priya-reveal.mp4
 * for the reveal beat (identified by matching the visible gesture/expression
 * against the persona library's descriptions) — kept the same choices here
 * rather than letting the seeded picker potentially choose a different pool
 * member, so this is a fair "same remix, fixed caption placement" comparison,
 * not a different remix entirely.
 */
async function main() {
  const clips: RunwayClip[] = [
    {
      type: "video",
      videoSrc: "persona-library/priya-hook.mp4",
      durationInFrames: 151,
      caption: "Everyone's been asking about my skin lately.",
      captionPosition: "top",
    },
    {
      type: "image",
      imageSrc: "glovibe-product.jpg",
      durationInFrames: 120,
      caption: "It's this. Kumkumadi Night Renewal Cream.",
      captionPosition: "bottom",
    },
    {
      type: "video",
      videoSrc: "persona-library/priya-reveal.mp4",
      durationInFrames: 213,
      caption: "Three ingredients. Real glow.",
      captionPosition: "top",
    },
  ];

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const outPath = path.join(process.cwd(), "out", "reelA-glovibe-remix-v2.mp4");
  await writeFile(outPath, buffer);
  console.log("Rendered:", outPath, buffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
