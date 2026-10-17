import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Pulls real JPEG frames out of a video buffer at the given timestamps
 * (seconds), same ffmpeg single-frame-grab pattern as lib/render/poster.ts.
 * A timestamp past the video's actual length just fails that one ffmpeg
 * call — caught and skipped, not fatal — since reels here are short
 * (~6-15s) and callers pass a fixed spread of timestamps without knowing
 * each video's real duration up front.
 */
export async function extractFrames(videoBuffer: Buffer, timestamps: number[]): Promise<Buffer[]> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "trendcraft-frames-"));
  const videoPath = path.join(tmpDir, "in.mp4");
  const frames: Buffer[] = [];
  try {
    await writeFile(videoPath, videoBuffer);
    for (let i = 0; i < timestamps.length; i++) {
      const framePath = path.join(tmpDir, `frame-${i}.jpg`);
      try {
        await execFileAsync("ffmpeg", [
          "-y",
          "-ss",
          String(timestamps[i]),
          "-i",
          videoPath,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          framePath,
        ]);
        frames.push(await readFile(framePath));
      } catch {
        // This one timestamp didn't work (past end of video, etc.) — skip it.
      }
    }
    return frames;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
