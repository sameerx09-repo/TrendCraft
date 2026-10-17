import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { put } from "@/lib/storage";

const execFileAsync = promisify(execFile);

/**
 * A real static frame from the actual rendered video, saved once at render
 * time — confirmed live this was missing entirely: the Remixes/Generate
 * Content grid only ever showed a plain CSS gradient for every card
 * (never an image), because the earlier "forever loading" fix made the
 * real <video> mount only on hover (necessary — 88+ simultaneous video
 * loads saturated the browser's connection pool), but nothing filled the
 * gap for the non-hovered, default state. A poster JPEG is a few KB, not
 * a video — showing it unconditionally for every card doesn't reintroduce
 * that problem.
 *
 * Saved at a path derived purely from postId (`${postId}-poster.jpg`),
 * independent of the video's own filename (which varies: "-persona.mp4",
 * "-artifact.mp4", "-runway.mp4", plain ".mp4") — so the frontend can
 * always construct the URL from post.id alone, no schema change needed.
 * Failure here never fails the render itself — a missing poster just means
 * the card falls back to the gradient, same as before this existed.
 */
export async function savePosterFrame(postId: string, videoBuffer: Buffer): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "trendcraft-poster-"));
  const videoPath = path.join(tmpDir, "in.mp4");
  const posterPath = path.join(tmpDir, "poster.jpg");
  try {
    await writeFile(videoPath, videoBuffer);
    // 0.2s in, not frame 0 — confirmed live frame 0 is frequently still
    // mid-fade-in (near-black/blank) for these compositions' pop-in
    // caption animation.
    await execFileAsync("ffmpeg", ["-y", "-ss", "0.2", "-i", videoPath, "-frames:v", "1", "-q:v", "3", posterPath]);
    const posterBuffer = await readFile(posterPath);
    await put("rendered-posts", `${postId}-poster.jpg`, posterBuffer);
  } catch {
    // Best-effort — see doc comment above.
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
