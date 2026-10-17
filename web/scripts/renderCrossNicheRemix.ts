import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { writeFile } from "fs/promises";
import path from "path";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

/**
 * Cross-niche format-borrow test (the brainstorm this proves out): source is
 * a real, general-virality Instagram reel (@gehnaadvani, ~58k plays, tag
 * "relatable") for a Dyson hair-dryer/leave-in-treatment combo — haircare,
 * not skincare, found via format/category hashtags (storytime/grwm/relatable)
 * rather than brand hashtags. Real 5-beat structure identified by extracting
 * frames + real scene-cut detection (not guessed): relatable everyday hook ->
 * product #1 intro -> texture/application close-up -> product #2 intro ->
 * happy result reveal. GloVibe copy below matches this STRUCTURE with a
 * single hero product (Kumkumadi cream) standing in for the source's two
 * products, never copying the source's actual wording.
 */
async function main() {
  const clips: RunwayClip[] = [
    {
      type: "video",
      videoSrc: "persona-library/priya-deadpan.mp4",
      durationInFrames: 151,
      caption: "My skin's been asking for a refresh lately.",
      captionPosition: "top",
    },
    {
      type: "video",
      videoSrc: "persona-library/priya-hook.mp4",
      durationInFrames: 151,
      caption: "Lately I've been reaching for this every night.",
      captionPosition: "top",
    },
    {
      type: "image",
      imageSrc: "glovibe-product.jpg",
      durationInFrames: 100,
      caption: "Kumkumadi Night Renewal Cream — light, silky texture.",
      captionPosition: "bottom",
    },
    {
      type: "video",
      videoSrc: "persona-library/priya-reveal.mp4",
      durationInFrames: 213,
      caption: "The glow by morning was real.",
      captionPosition: "top",
    },
    {
      type: "video",
      videoSrc: "persona-library/priya-point.mp4",
      durationInFrames: 151,
      caption: "Kumkumadi Night Renewal Cream. Link in bio.",
      captionPosition: "bottom",
    },
  ];

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const outPath = path.join(process.cwd(), "out", "crossniche-glovibe-remix.mp4");
  await writeFile(outPath, buffer);
  console.log("Rendered:", outPath, buffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
