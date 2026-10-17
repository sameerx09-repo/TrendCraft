import { NextRequest, NextResponse } from "next/server";
import { createTalkingHeadVideo, getVideoStatus, downloadVideoBuffer, listAvatars, listVoices } from "@/lib/clients/heygen";
import { put } from "@/lib/storage";

/**
 * Phase 0 proof route: exercises the HeyGen create -> status -> download ->
 * local storage path end to end, same shape Phase 2's real Inngest job will
 * follow. Split into POST (create, returns immediately) and GET (poll status,
 * download+store once completed) because real generation is NOT instant —
 * only the mock fixture pretends it is. Not a real feature; delete once
 * Phase 2 has a real Inngest function for this.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const avatars = await listAvatars();
  const voices = await listVoices();

  const avatarId = body.avatarId ?? avatars[0].avatarId;
  const voiceId = body.voiceId ?? voices[0].voiceId;
  const script = body.script ?? "Skincare trends are temporary. Kumkumadi oil is permanent.";

  const created = await createTalkingHeadVideo({ avatarId, voiceId, script, aspectRatio: "9:16" });
  return NextResponse.json({ created, avatarId, voiceId });
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "videoId query param required" }, { status: 400 });

  const status = await getVideoStatus(videoId);
  if (status.status !== "completed") {
    return NextResponse.json({ videoId, status }, { status: 202 });
  }

  const buffer = await downloadVideoBuffer(videoId, status.videoUrl);
  const url = await put("talking-head-videos", `${videoId}.mp4`, buffer);

  return NextResponse.json({ videoId, status, storedUrl: url, sizeBytes: buffer.length });
}
