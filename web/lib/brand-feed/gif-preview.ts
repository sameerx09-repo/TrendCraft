import "server-only";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { get, put } from "@/lib/storage";

const run = promisify(execFile);
const globalCache = globalThis as unknown as {
  feedGifPreviews?: Map<string, Promise<Buffer>>;
};
const pending = (globalCache.feedGifPreviews ??= new Map());
export async function gifPreview(src: string): Promise<Buffer> {
  const match = src.match(
    /^\/storage\/viral-trend-artifacts\/([a-zA-Z0-9_-]+\.gif)$/i,
  );
  if (!match) throw new Error("This reference is not a saved GIF.");
  const input = await get("viral-trend-artifacts", match[1]);
  if (input.length > 32 * 1024 * 1024)
    throw new Error("This reference is too large for a preview.");
  const key =
    "feed-preview-" + createHash("sha256").update(input).digest("hex") + ".mp4";
  try {
    return await get("viral-trend-artifacts", key);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let operation = pending.get(key);
  if (!operation) {
    operation = (async () => {
      const prefix = path.join(os.tmpdir(), "trendcraft-feed-preview-");
      const directory = await mkdtemp(prefix);
      try {
        const source = path.join(directory, "source.gif"),
          target = path.join(directory, "preview.mp4");
        await writeFile(source, input);
        await run(
          "ffmpeg",
          [
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            source,
            "-t",
            "12",
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
            target,
          ],
          { timeout: 60_000, maxBuffer: 1024 * 1024 },
        );
        const bytes = await readFile(target);
        await put("viral-trend-artifacts", key, bytes);
        return bytes;
      } finally {
        if (path.resolve(directory).startsWith(prefix))
          await rm(directory, { recursive: true, force: true });
      }
    })();
    pending.set(key, operation);
  }
  try {
    return await operation;
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}
