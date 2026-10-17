import { renderPersonaLibraryRemix } from "../lib/render/renderRunwayMultiClip";
import { writeFile } from "fs/promises";
import path from "path";
import type { RunwayClip } from "../remotion/RunwayMultiClipRemix";

/**
 * Template-remix test: reuse the downloaded reel5 source video UNTOUCHED,
 * only swap the caption layer via Remotion's existing ClipShot overlay —
 * no persona clip, no Runway generation. Real duration (311 frames @30fps)
 * confirmed via ffprobe against the actual downloaded file, not assumed.
 */
async function main() {
  const clips: RunwayClip[] = [
    {
      type: "video",
      videoSrc: "test-assets/reel5-source.mp4",
      durationInFrames: 311,
      caption: "How my skincare routine accidentally came into my life",
      captionPosition: "bottom",
      captionSizeHint: "medium",
    },
  ];

  const buffer = await renderPersonaLibraryRemix({ brandName: "GloVibe", clips });
  const outPath = path.join(process.cwd(), "out", "reel5-template-remix-test.mp4");
  await writeFile(outPath, buffer);
  console.log("Rendered:", outPath, buffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
