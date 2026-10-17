import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { get } from "@/lib/storage";
import type { RunwayClip } from "@/remotion/RunwayMultiClipRemix";

const execFileAsync = promisify(execFile);

const STILL_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const FPS = 30;
/** Same convention as personaLibrary.ts's PROOF_IMAGE — a still image gets
 * a fixed Ken Burns pan per caption line, no probing needed since there's
 * no duration to measure. ~2.5s is comfortable reading time for one short
 * caption line. */
const PER_CAPTION_IMAGE_FRAMES = 75;
/** Used only if ffprobe is missing or fails on a real video file — better
 * to show something than to hard-crash the whole render over a duration
 * we can't measure. 4s is short enough that Remotion's <Video> will just
 * play a truncated (not frozen) clip if the real file is longer. */
const FALLBACK_VIDEO_DURATION_FRAMES = 120;

/** Real, ffprobe-measured duration — same "no guessing" standard
 * personaLibrary.ts's own clips are held to. Returns null (not a thrown
 * error) on any failure, so the caller can fall back cleanly. */
async function probeVideoDurationInFrames(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const seconds = parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round(seconds * FPS);
  } catch {
    return null;
  }
}

/**
 * Splits durationInFrames across N captions as evenly as possible (last one
 * absorbs the remainder so the total always matches exactly).
 */
function splitDuration(total: number, count: number): number[] {
  if (count <= 0) return [];
  const each = Math.max(1, Math.floor(total / count));
  const out = Array.from({ length: count }, () => each);
  out[out.length - 1] = total - each * (count - 1);
  return out;
}

/**
 * Turns one manually-uploaded Viral Trends artifact into a RunwayClip ready
 * for RunwayMultiClipRemix — the same composition the persona-library path
 * already uses, just fed a real admin-sourced file instead of a pool pick.
 *
 * Remotion's staticFile() (used inside ClipShot) only resolves paths under
 * this project's public/ dir — artifacts live under storage/viral-trend-
 * artifacts/ instead, served through a separate API route, so the file has
 * to be copied into public/ first. Same gotcha, same fix, as
 * renderRunwayMultiClipVideo's per-post dynamic clips in
 * lib/render/renderRunwayMultiClip.ts.
 */
export async function prepareArtifactClip(
  artifact: { id: string; fileUrl: string; label: string },
  /**
   * One or more caption lines to show, IN SEQUENCE, over this one clip's
   * own duration — not simultaneously stacked. distributeBeatsAcrossClips
   * (lib/render/skeletonLibrary.ts) groups multiple beats onto a single
   * clip when there are fewer real artifacts than lines of copy; showing
   * all of them at once as one static block was confirmed live to read as
   * a jumbled run-on (a punchy hook immediately followed by unrelated ad
   * copy, no separation). Playing them one at a time — hook, then payoff,
   * then CTA — over the clip's own real duration is what an actual single-
   * video ad looks like.
   */
  captions: string[],
  /**
   * The reel's own real caption style (top/middle/bottom, small..huge) —
   * confirmed live this was never threaded through here at all, so every
   * artifact remix rendered with ClipShot's hardcoded "bottom" default
   * regardless of where the actual viral reel's caption sat. generate-
   * persona/route.ts already does this for the persona-library path (reads
   * trendItem.captionPosition/captionSize, lazily analyzing the reel's
   * thumbnail via analyzeCaptionStyle on first use) — callers here should
   * pass the same fields for consistency, once a real per-reel image
   * exists to analyze (manual_viral reels have no thumbnailUrl, so that
   * step needs its own real image source — not solved by this function).
   */
  style?: {
    position?: "top" | "middle" | "bottom" | null;
    sizeHint?: "small" | "medium" | "large" | "huge" | null;
    hasBackground?: boolean | null;
  }
): Promise<RunwayClip> {
  const key = artifact.fileUrl.split("/").pop()!; // "<artifactId>.<ext>"
  const ext = (key.split(".").pop() || "bin").toLowerCase();
  const isStillImage = STILL_IMAGE_EXTENSIONS.has(ext);
  const isAnimatedGif = ext === "gif";

  const buffer = await get("viral-trend-artifacts", key);
  const destDir = path.join(process.cwd(), "public", "viral-trend-clips");
  await mkdir(destDir, { recursive: true });
  const relPath = `viral-trend-clips/${key}`;
  const absPath = path.join(process.cwd(), "public", relPath);
  await writeFile(absPath, buffer);

  const captionPosition = style?.position ?? undefined;
  const captionSizeHint = style?.sizeHint ?? undefined;
  const captionHasBackground = style?.hasBackground ?? undefined;
  const lines = captions.length > 0 ? captions : [""];

  if (isStillImage) {
    const durations = splitDuration(PER_CAPTION_IMAGE_FRAMES * lines.length, lines.length);
    return {
      type: "image",
      imageSrc: relPath,
      durationInFrames: PER_CAPTION_IMAGE_FRAMES * lines.length,
      caption: lines[0],
      captions: lines.map((text, i) => ({ text, durationInFrames: durations[i] })),
      captionPosition,
      captionSizeHint,
      captionHasBackground,
    };
  }

  if (isAnimatedGif) {
    // Remotion's own guidance: an animated GIF rendered via <Img> isn't
    // frame-locked to the composition timeline during headless export —
    // confirmed live twice now, the SAME source file rendered smoothly one
    // time and visibly glitched the next, because the GIF just keeps
    // playing on its own clock, independent of and out of sync with
    // Remotion's deterministic per-frame capture. A real video file
    // doesn't have this problem — <Video> seeks to an exact timestamp per
    // frame, same as every other video clip in this app. Transcoding once
    // here (not caching — this is a low-frequency, admin-triggered path,
    // and re-transcoding on every render keeps this function simple and
    // always correct rather than managing a cache-invalidation story for
    // a few hundred KB of work) turns the non-deterministic case into the
    // same deterministic one every other video already is.
    const mp4RelPath = `viral-trend-clips/${artifact.id}.mp4`;
    const mp4AbsPath = path.join(process.cwd(), "public", mp4RelPath);
    // libx264 hard-requires even width/height — confirmed live this GIF
    // transcode threw "height not divisible by 2" and produced a 0-byte
    // file on a real 498x485 gif (485 is odd). Real meme gifs are exported
    // at whatever size the source video happened to be, with no reason to
    // land on an even number — this isn't a rare edge case, it's roughly
    // half of them. scale rounds each dimension down to the nearest even
    // number (trunc(x/2)*2), a 1px crop at most, imperceptible here.
    await execFileAsync("ffmpeg", [
      "-y", "-i", absPath,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4AbsPath,
    ]);
    const probed = await probeVideoDurationInFrames(mp4AbsPath);
    const total = probed ?? FALLBACK_VIDEO_DURATION_FRAMES;
    const durations = splitDuration(total, lines.length);
    return {
      type: "video",
      videoSrc: mp4RelPath,
      durationInFrames: total,
      caption: lines[0],
      captions: lines.map((text, i) => ({ text, durationInFrames: durations[i] })),
      captionPosition,
      captionSizeHint,
      captionHasBackground,
    };
  }

  const probed = await probeVideoDurationInFrames(absPath);
  const total = probed ?? FALLBACK_VIDEO_DURATION_FRAMES;
  const durations = splitDuration(total, lines.length);
  return {
    type: "video",
    videoSrc: relPath,
    durationInFrames: total,
    caption: lines[0],
    captions: lines.map((text, i) => ({ text, durationInFrames: durations[i] })),
    captionPosition,
    captionSizeHint,
    captionHasBackground,
  };
}
