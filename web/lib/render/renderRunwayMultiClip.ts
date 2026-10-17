import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import os from "os";
import net from "net";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import type { RunwayClip } from "@/remotion/RunwayMultiClipRemix";

/**
 * A hardcoded render port (4455) reliably fails after the first render of a
 * long-lived process: confirmed live (Get-NetTCPConnection) that a Remotion
 * render leaves a node process LISTENING on the port after renderMedia
 * returns — the internal static server doesn't get torn down cleanly (or
 * not before the next render tries to bind the same port). One-off scripts
 * never hit this, because the process exits and the OS reclaims the port;
 * a long-running Inngest function inside next dev does — and it's the SAME
 * process accumulating listeners across every render it ever runs, not one
 * leak per render, confirmed live: after a day of testing, the actual
 * `next dev` process (Get-CimInstance showed start-server.js) was still
 * LISTENing on 5 separate ports at once, all leaked from earlier renders.
 *
 * Random-only port selection (the original fix) just lowers collision odds
 * — it doesn't eliminate them, and degrades exactly as the zombie count
 * grows, which is what actually happened: confirmed live, a real render
 * failed with "port 4620 ... not available" once enough zombies had
 * accumulated in the 400-port range to make a collision likely. This binds
 * a real test listener before committing to a port and retries on
 * collision, so it stays correct regardless of how many zombies pile up
 * (as long as the range still has room), instead of just hoping.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

async function pickRenderPort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = 4450 + Math.floor(Math.random() * 400);
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(
    "pickRenderPort: no free port found in range 4450-4849 after 20 attempts — the zombie-listener pool is likely exhausted; a next-dev restart will reclaim them",
  );
}

/**
 * bundle() was called fresh on every single render — confirmed live this
 * was the actual reason renders felt "stuck": two real calls measured at
 * 90s and 2.8min, not the ~60s this file's callers used to claim, and both
 * genuinely completed (200), they just take that long. Caching the
 * bundle's promise at module scope means only the FIRST render in a given
 * server process pays the full bundling cost — every render after that
 * reuses the same serveUrl. Caching the promise itself (not just the
 * resolved value) matters: if two renders start before the first bundle
 * finishes, they share the one in-flight bundle instead of triggering two.
 * Trade-off: a Remotion component edit won't be picked up until the dev
 * server restarts — acceptable, restarts already happen often in this
 * session, and it's a small price for cutting every render after the
 * first from ~90s+ down to just the actual render time.
 */
let cachedBundleLocation: Promise<string> | null = null;
function getBundleLocation(): Promise<string> {
  if (!cachedBundleLocation) {
    cachedBundleLocation = bundle({
      entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
    }).catch((e) => {
      cachedBundleLocation = null; // don't poison the cache on a real failure — let the next call retry
      throw e;
    });
  }
  return cachedBundleLocation;
}

/**
 * The bundle above is a real webpack build output — it snapshots public/'s
 * contents at build time, not a live passthrough to the real directory.
 * Confirmed live: a file written into public/viral-trend-clips/ *after*
 * this process's first render (which is what populates the cache) throws
 * "Error loading image with src: .../public/viral-trend-clips/<file>" even
 * though the real file genuinely exists on disk — the served bundle just
 * doesn't know about it yet. Persona-library clips never hit this because
 * they're static files that existed before the server ever started;
 * artifact-remix clips are the opposite by construction (uploaded on
 * demand, inherently newer than whatever's cached) — so that render path
 * calls this to force a fresh bundle every time instead of trying to
 * detect staleness, accepting the ~90s rebuild cost as the real price of
 * correctness for what's a rare, admin-triggered action, not a hot path.
 */
export function bustBundleCacheForNewPublicFiles(): void {
  cachedBundleLocation = null;
}

export interface RunwayMultiClipRenderInput {
  postId: string;
  brandName: string;
  /** Each beat's downloaded clip buffer + duration + caption. Written into
   * public/runway-clips/ first — Remotion's staticFile() resolves relative
   * to the project root's public/ dir (the same gotcha documented in
   * TalkingHeadEdit.tsx), so per-post dynamic clips need a real file there,
   * not just a Buffer in memory. */
  clips: { buffer: Buffer; durationInFrames: number; caption: string }[];
}

export async function renderRunwayMultiClipVideo(
  input: RunwayMultiClipRenderInput,
): Promise<Buffer> {
  const publicClipsDir = path.join(process.cwd(), "public", "runway-clips");
  await mkdir(publicClipsDir, { recursive: true });

  const clipProps: RunwayClip[] = [];
  for (let i = 0; i < input.clips.length; i++) {
    const relPath = `runway-clips/${input.postId}-${i}.mp4`;
    await writeFile(
      path.join(process.cwd(), "public", relPath),
      input.clips[i].buffer,
    );
    clipProps.push({
      videoSrc: relPath,
      durationInFrames: input.clips[i].durationInFrames,
      caption: input.clips[i].caption,
    });
  }

  const props = { brandName: input.brandName, clips: clipProps };
  const port = await pickRenderPort();

  const bundleLocation = await getBundleLocation();
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "RunwayMultiClipRemix",
    inputProps: props,
    port,
  });

  const tmpDir = await mkdtemp(
    path.join(os.tmpdir(), "trendcraft-runway-render-"),
  );
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: props,
      port,
    });
    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Persona-library render path — no buffer-writing step, unlike
 * renderRunwayMultiClipVideo above. Library clips and the product photo
 * are already real static files under public/ (nothing was freshly
 * generated), so clips can reference them directly by their existing
 * relative path instead of round-tripping through a Buffer + a
 * per-post copy. This is what makes a persona-library remix genuinely
 * free (no Runway credits, no redundant file writes) versus the
 * per-post-generation path this function's sibling supports.
 */
export async function renderPersonaLibraryRemix(input: {
  brandName: string;
  clips: RunwayClip[];
  previewStyle?: boolean;
}): Promise<Buffer> {
  const props = {
    brandName: input.brandName,
    clips: input.clips,
    previewStyle: input.previewStyle ?? false,
  };
  const port = await pickRenderPort();

  const bundleLocation = await getBundleLocation();
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "RunwayMultiClipRemix",
    inputProps: props,
    port,
  });

  const tmpDir = await mkdtemp(
    path.join(os.tmpdir(), "trendcraft-persona-render-"),
  );
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: props,
      port,
    });
    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
