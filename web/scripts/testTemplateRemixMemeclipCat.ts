import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { writeFile } from "fs/promises";
import path from "path";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

/**
 * Template-remix test #3: a real end-to-end generated asset (MemeClip's
 * free "Freestyle" template, fed our own Pexels-sourced kitten photo via a
 * DataTransfer-based upload — no signup needed for 1 free generation),
 * 161 frames @30fps confirmed via ffprobe, cropped to 720x1280.
 */
async function main() {
  const clips: RunwayClip[] = [
    {
      type: "video",
      videoSrc: "test-assets/memeclip-kitten-dance-fit.mp4",
      durationInFrames: 161,
      caption: "How my skincare routine accidentally came into my life",
      captionPosition: "top",
      captionSizeHint: "medium",
    },
  ];

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const outPath = path.join(process.cwd(), "out", "memeclip-catdance-remix-test.mp4");
  await writeFile(outPath, buffer);
  console.log("Rendered:", outPath, buffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
