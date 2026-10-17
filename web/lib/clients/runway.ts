import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

export interface CreateClipParams {
  prompt: string;
  /** data: URI or public HTTPS URL. Runway gen-4.5 (via OpenRouter) only
   * supports first_frame anchoring, not last_frame — confirmed live against
   * the real /api/v1/videos/models capabilities endpoint this session, not
   * assumed from docs (which claimed otherwise). */
  firstFrameImageUrl?: string;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: number;
}
export interface CreateClipResult {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
}
export interface ClipStatusResult {
  status: "pending" | "processing" | "completed" | "failed";
  contentUrl?: string;
}

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "runway");
const MODEL = "runway/gen-4.5";

/**
 * Real endpoint confirmed live this session: POST https://openrouter.ai/api/v1/videos.
 * Known real constraints (from GET /api/v1/videos/models, not docs, which
 * were wrong about resolution and last_frame support):
 * - resolution: 720p only
 * - aspect_ratio: 16:9 or 9:16 only
 * - duration: 2-10 seconds
 * - frame_images: first_frame only, no last_frame
 *
 * MOCK_MODE cycles through the 3 real captured beat clips
 * (fixtures/runway/sample-clips.json) round-robin by a simple counter, so
 * repeated calls in a dev session exercise different fixture clips rather
 * than always returning the same one.
 */
let mockClipCursor = 0;

export async function createVideoClip(params: CreateClipParams): Promise<CreateClipResult> {
  if (isMockMode()) {
    const manifest = JSON.parse(await readFile(path.join(FIXTURES_DIR, "sample-clips.json"), "utf-8"));
    const clip = manifest.clips[mockClipCursor % manifest.clips.length];
    mockClipCursor++;
    return { id: clip.id, status: "completed" };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const body: Record<string, unknown> = {
    model: MODEL,
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio,
    duration: params.durationSeconds,
    resolution: "720p", // the only supported value, confirmed live
  };
  if (params.firstFrameImageUrl) {
    body.frame_images = [
      { type: "image_url", image_url: { url: params.firstFrameImageUrl }, frame_type: "first_frame" },
    ];
  }

  const res = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Runway clip create failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { id: data.id, status: data.status };
}

export async function getVideoClipStatus(id: string): Promise<ClipStatusResult> {
  if (isMockMode()) {
    return { status: "completed" };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch(`https://openrouter.ai/api/v1/videos/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Runway status check failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const contentUrl = data.unsigned_urls?.[0]
    ? `https://openrouter.ai/api/v1/videos/${id}/content?index=0`
    : undefined;
  return { status: data.status, contentUrl };
}

/** Real mode fetches the content endpoint (needs the same auth header,
 * unlike HeyGen's signed URLs which don't). Mock mode reads the matching
 * real fixture clip directly off disk. */
export async function downloadVideoClip(id: string, contentUrl?: string): Promise<Buffer> {
  if (isMockMode()) {
    const manifest = JSON.parse(await readFile(path.join(FIXTURES_DIR, "sample-clips.json"), "utf-8"));
    const clip = manifest.clips.find((c: { id: string }) => c.id === id) ?? manifest.clips[0];
    return readFile(path.join(FIXTURES_DIR, clip.file));
  }
  if (!contentUrl) throw new Error("downloadVideoClip: contentUrl required in real mode");
  const key = process.env.OPENROUTER_API_KEY;
  const res = await fetch(contentUrl, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Runway clip download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
