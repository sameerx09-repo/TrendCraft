import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import os from "os";
import { readFile, mkdtemp, rm } from "fs/promises";

export interface SlideshowRenderProps {
  slides: string[];
  brandPrimary: string;
  brandSecondary: string;
  brandName: string;
}

/**
 * Programmatic render (bundle() + renderMedia()), not the CLI — this runs
 * inside an Inngest job, not a terminal. Re-bundles on every call, which is
 * slow (~seconds) but simple and correct for MVP volume; caching the bundle
 * across renders is a real perf improvement to make once render frequency
 * matters (not needed at "a handful of posts per refresh" scale).
 */
export async function renderSlideshowVideo(props: SlideshowRenderProps): Promise<Buffer> {
  const bundleLocation = await bundle({
    entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "SlideshowRemix",
    inputProps: props,
    port: 4455, // see the port comment on renderMedia() below
  });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "trendcraft-render-"));
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: props,
      // Windows reserves several TCP ranges (netsh interface ipv4 show
      // excludedportrange) that overlap common defaults, including
      // whatever renderMedia() tries first — hit this concretely (same
      // class of issue as the `remotion render` CLI's --port flag earlier
      // in the session). 4455 is outside all the excluded ranges observed
      // on this machine.
      port: 4455,
    });
    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
