import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { writeFile } from "fs/promises";
import path from "path";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

/**
 * New source reel (real, scraped live via Apify this session — an acne
 * micro-needle-patch demo): skeptic hook -> apply-to-skin claim -> reveal
 * -> product/CTA close. Structurally different from Reel A (which was
 * calm-intro -> product-hold -> reveal, no real skeptic beat or CTA close).
 * Original GloVibe copy below matches the STRUCTURE (skeptic -> claim ->
 * reveal -> CTA), not the source's actual wording — same approach used for
 * every remix this session, real reel analyzed for pattern/shape, never
 * for copying its text.
 */
async function main() {
  const clips: RunwayClip[] = [
    {
      type: "video",
      videoSrc: "persona-library/priya-deadpan.mp4", // "flat/skeptical hook variant" — matches this reel's skeptic opening
      durationInFrames: 151,
      caption: "I was skeptical about skincare hacks too.",
      captionPosition: "top",
    },
    {
      type: "image",
      imageSrc: "glovibe-product.jpg",
      durationInFrames: 120,
      caption: "Kumkumadi oil calms redness overnight.",
      captionPosition: "bottom",
    },
    {
      type: "video",
      videoSrc: "persona-library/priya-smirk.mp4", // "playful reaction" — matches the reel's satisfied reveal beat
      durationInFrames: 151,
      caption: "The difference by morning was real.",
      captionPosition: "top",
    },
    {
      type: "video",
      videoSrc: "persona-library/priya-point.mp4", // "point to camera CTA" — matches the reel's closing product/CTA beat
      durationInFrames: 151,
      caption: "Kumkumadi Night Renewal Cream. Link in bio.",
      captionPosition: "bottom",
    },
  ];

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const outPath = path.join(process.cwd(), "out", "newreel-glovibe-remix.mp4");
  await writeFile(outPath, buffer);
  console.log("Rendered:", outPath, buffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
