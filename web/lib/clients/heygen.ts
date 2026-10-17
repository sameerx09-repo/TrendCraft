import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

export interface AvatarOption {
  avatarId: string;
  groupName: string;
  label: string;
  gender: string;
}
export interface VoiceOption {
  voiceId: string;
  label: string;
  language: string;
  gender: string;
}
export interface CreateVideoResult {
  videoId: string;
  status: "waiting" | "processing" | "completed" | "failed";
}
export interface VideoStatusResult {
  status: "waiting" | "processing" | "completed" | "failed";
  videoUrl?: string;
  durationSeconds?: number;
  failureCode?: string;
  failureMessage?: string;
}

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "heygen");

/**
 * Two real fixtures exist, both captured this session via the app's actual
 * client code (not a manual script): Cora (int'l default) and Kavya (the
 * Indian avatar that failed twice in an earlier session — Avatar IV monthly
 * cap, then insufficient credits on the Avatar III fallback — before
 * finally succeeding once real credits were available). Keyed by the real
 * HeyGen video_id each was captured under, so mock mode's create/status/
 * download all agree on the same fixture for a given "video".
 */
const FIXTURE_VIDEOS: Record<string, { jsonFile: string; mp4File: string; avatarIds: string[] }> = {
  c77ae1272954412abf3d9cb660ee7d50: {
    jsonFile: "sample-cora-video.json",
    mp4File: "sample-cora-video.mp4",
    avatarIds: ["ee08152160ac45668be9d2a3684bf137"],
  },
  "8c43251290824ce496817388bc667ed4": {
    jsonFile: "sample-kavya-video.json",
    mp4File: "sample-kavya-video.mp4",
    avatarIds: ["Kavya_sitting_sofa_front", "Kavya_standing_indoor_front"],
  },
};
const DEFAULT_FIXTURE_VIDEO_ID = "c77ae1272954412abf3d9cb660ee7d50";

function fixtureVideoIdForAvatar(avatarId: string): string {
  const match = Object.entries(FIXTURE_VIDEOS).find(([, f]) => f.avatarIds.includes(avatarId));
  return match ? match[0] : DEFAULT_FIXTURE_VIDEO_ID;
}

export async function listAvatars(): Promise<AvatarOption[]> {
  const catalog = JSON.parse(await readFile(path.join(FIXTURES_DIR, "catalog.json"), "utf-8"));
  // Real path (list_avatar_groups + list_avatar_looks) is a Phase 2 task —
  // the catalog fixture's IDs are real, captured this session, so this list
  // is genuinely usable in the UI even before that's wired up.
  return catalog.avatars;
}

export async function listVoices(): Promise<VoiceOption[]> {
  const catalog = JSON.parse(await readFile(path.join(FIXTURES_DIR, "catalog.json"), "utf-8"));
  return catalog.voices;
}

/**
 * MOCK_MODE returns whichever fixture's avatar_id matches what was
 * requested (Cora vs Kavya), not always the same video regardless of
 * choice — getVideoStatus()/downloadVideoBuffer() below key off the
 * returned videoId to stay consistent.
 */
export async function createTalkingHeadVideo(params: {
  avatarId: string;
  voiceId: string;
  script: string;
  aspectRatio?: string;
}): Promise<CreateVideoResult> {
  if (isMockMode()) {
    return { videoId: fixtureVideoIdForAvatar(params.avatarId), status: "completed" };
  }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is not set");

  // Verify against current HeyGen API docs before the first real run —
  // same "verify at build time" caveat as needs_deep_dive.md applies to
  // every third-party API shape in this codebase.
  const res = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: params.avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: params.script, voice_id: params.voiceId },
        },
      ],
      dimension: params.aspectRatio === "9:16" ? { width: 720, height: 1280 } : { width: 1280, height: 720 },
    }),
  });
  if (!res.ok) throw new Error(`HeyGen create failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { videoId: data.data.video_id, status: "waiting" };
}

export async function getVideoStatus(videoId: string): Promise<VideoStatusResult> {
  if (isMockMode()) {
    const fixture = FIXTURE_VIDEOS[videoId] ?? FIXTURE_VIDEOS[DEFAULT_FIXTURE_VIDEO_ID];
    const meta = JSON.parse(await readFile(path.join(FIXTURES_DIR, fixture.jsonFile), "utf-8"));
    return { status: "completed", durationSeconds: meta.duration };
  }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is not set");

  const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (!res.ok) throw new Error(`HeyGen status check failed: ${res.status} ${await res.text()}`);
  const { data } = await res.json();
  return {
    status: data.status,
    videoUrl: data.video_url ?? undefined,
    durationSeconds: data.duration ?? undefined,
    failureCode: data.error?.code,
    failureMessage: data.error?.message,
  };
}

/** Real mode fetches the (expiring) signed video_url — call this
 * immediately on completion, then hand the buffer to lib/storage so it's
 * never re-fetched from an expired URL. Mock mode reads the matching real
 * video (Cora or Kavya) directly off disk. */
export async function downloadVideoBuffer(videoId: string, videoUrl?: string): Promise<Buffer> {
  if (isMockMode()) {
    const fixture = FIXTURE_VIDEOS[videoId] ?? FIXTURE_VIDEOS[DEFAULT_FIXTURE_VIDEO_ID];
    return readFile(path.join(FIXTURES_DIR, fixture.mp4File));
  }
  if (!videoUrl) throw new Error("downloadVideoBuffer: videoUrl required in real mode");
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`HeyGen video download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
