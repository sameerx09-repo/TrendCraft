import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { writeFile } from "fs/promises";
import path from "path";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

/**
 * Template-remix test #2: a genuinely caption-free source (Tenor's
 * "cat-dance-cat" GIF, converted to mp4, 117 frames @30fps confirmed via
 * ffprobe) — unlike reel5-source.mp4, this one has no burned-in text, so
 * this is the real test of whether caption-swap-only works when the
 * source material is actually clean.
 */
async function main() {
  const clips: RunwayClip[] = [
    {
      type: "video",
      videoSrc: "test-assets/tenor-catdance.mp4",
      durationInFrames: 117,
      caption: "How my skincare routine accidentally came into my life",
      captionPosition: "top",
      captionSizeHint: "medium",
    },
  ];

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const outPath = path.join(process.cwd(), "out", "tenor-catdance-remix-test.mp4");
  await writeFile(outPath, buffer);
  console.log("Rendered:", outPath, buffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
