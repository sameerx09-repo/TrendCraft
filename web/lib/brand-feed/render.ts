import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { get, put } from "@/lib/storage";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { invalidateTtlCache } from "@/lib/db/ttlCache";
import { savePosterFrame } from "@/lib/render/poster";
import type { RunwayClip } from "@/remotion/RunwayMultiClipRemix";
import type { RemixIdea } from "./types";
import { isLocalMedia } from "./planner";
import { mutateFeed } from "./store";
const run = promisify(execFile);

export async function freezeScenes(idea: RemixIdea, postId: string) {
  const destination = path.join(process.cwd(), "public", "brand-feed", postId);
  await mkdir(destination, { recursive: true });
  const cached = new Map<string, string>();
  const frozen = [];
  for (const [index, scene] of idea.scenes.entries()) {
    let local = cached.get(scene.src);
    if (!local) {
      let bytes: Buffer, extension: string;
      if (isLocalMedia(scene.src)) {
        const match = scene.src.match(
          /^\/storage\/(viral-trend-artifacts|source-videos)\/([^/]+)$/,
        )!;
        bytes = await get(
          match[1] as "viral-trend-artifacts" | "source-videos",
          match[2],
        );
        extension = match[2].split(".").pop()!;
      } else if (idea.kind === "product" && scene.type === "image") {
        const url = new URL(scene.src);
        if (
          url.protocol !== "https:" ||
          /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(
            url.hostname,
          )
        )
          throw new Error("This catalog image cannot be downloaded safely.");
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok)
          throw new Error(
            "The product image is unavailable. No assembly was started.",
          );
        const mime = (response.headers.get("content-type") || "").split(";")[0];
        const extensions: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };
        extension = extensions[mime];
        if (!extension)
          throw new Error("Use a JPG, PNG or WebP product image.");
        bytes = Buffer.from(await response.arrayBuffer());
      } else
        throw new Error(
          "This reel needs a locally saved source before assembly.",
        );
      if (bytes.length > 64 * 1024 * 1024)
        throw new Error("The source is too large for local assembly.");
      local = "brand-feed/" + postId + "/" + index + "." + extension;
      await writeFile(path.join(process.cwd(), "public", local), bytes);
      cached.set(scene.src, local);
    }
    frozen.push({ ...scene, src: local });
  }
  return frozen;
}
export async function renderFeedIdea(
  brandId: string,
  brandName: string,
  idea: RemixIdea,
  postId: string,
) {
  const update = async (
    state: "rendering" | "complete" | "failed",
    values: { url?: string; error?: string } = {},
  ) =>
    mutateFeed(brandId, (feed) => {
      const item = feed.ideas.find((i) => i.id === idea.id);
      if (item?.job?.postId === postId)
        item.job = {
          ...item.job,
          ...values,
          state,
          updatedAt: new Date().toISOString(),
        };
    });
  try {
    await update("rendering");
    const clips: RunwayClip[] = [];
    for (const [index, scene] of idea.scenes.entries()) {
      let src = scene.src;
      if (scene.type !== "image") {
        const target = "brand-feed/" + postId + "/scene-" + index + ".mp4";
        await run(
          "ffmpeg",
          [
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            path.join(process.cwd(), "public", src),
            "-t",
            String(scene.seconds),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "faststart",
            path.join(process.cwd(), "public", target),
          ],
          { timeout: 120_000, maxBuffer: 1024 * 1024 },
        );
        src = target;
      }
      clips.push({
        type: scene.type === "image" ? "image" : "video",
        ...(scene.type === "image" ? { imageSrc: src } : { videoSrc: src }),
        caption: scene.caption,
        durationInFrames: Math.round(scene.seconds * 30),
        fit: "contain",
        muted: true,
        still: true,
      });
    }
    const { renderPersonaLibraryRemix, bustBundleCacheForNewPublicFiles } =
      await import("@/lib/render/renderRunwayMultiClip");
    bustBundleCacheForNewPublicFiles();
    const buffer = await renderPersonaLibraryRemix({
      brandName,
      clips,
      previewStyle: true,
    });
    const url = await put(
      "rendered-posts",
      postId + "-brand-remix.mp4",
      buffer,
    );
    await db
      .update(posts)
      .set({
        renderedFileUrl: url,
        renderedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(posts.id, postId), eq(posts.brandProfileId, brandId)));
    await update("complete", { url });
    invalidateTtlCache("remixes");
    invalidateTtlCache("review");
    await savePosterFrame(postId, buffer).catch(() => {});
  } catch (error) {
    await update("failed", {
      error: error instanceof Error ? error.message : "Local assembly failed.",
    });
  }
}
