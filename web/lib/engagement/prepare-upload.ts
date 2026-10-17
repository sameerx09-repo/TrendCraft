import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MAX_VIDEO_BYTES, VIDEO_MIME_TYPES } from "./media-policy";
const run = promisify(execFile);
export async function prepareEngagementUpload(file: File) {
  const extension = VIDEO_MIME_TYPES[file.type];
  if (!extension) throw new Error("Use an MP4, WebM or MOV video.");
  if (!file.size || file.size > MAX_VIDEO_BYTES)
    throw new Error("Choose a video between 1 byte and 50 MB.");
  const prefix = path.join(os.tmpdir(), "trendcraft-engagement-upload-"),
    directory = await mkdtemp(prefix);
  try {
    const source = path.join(directory, "input." + extension),
      target = path.join(directory, "video.mp4"),
      poster = path.join(directory, "poster.jpg");
    await writeFile(source, Buffer.from(await file.arrayBuffer()));
    await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "faststart",
        target,
      ],
      { timeout: 180_000, maxBuffer: 1024 * 1024 },
    );
    await run(
      "ffmpeg",
      ["-y", "-i", target, "-frames:v", "1", "-vf", "scale=360:-2", poster],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    return { video: await readFile(target), poster: await readFile(poster) };
  } catch {
    throw new Error(
      "This video could not be processed. Check the file and try an MP4, WebM or MOV video.",
    );
  } finally {
    if (path.resolve(directory).startsWith(prefix))
      await rm(directory, { recursive: true, force: true });
  }
}
