import { NextResponse } from "next/server";
import { getFeedData } from "@/lib/brand-feed/data";
import { gifPreview } from "@/lib/brand-feed/gif-preview";
export const maxDuration = 90;
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams,
      index = Number(query.get("scene"));
    if (!Number.isInteger(index) || index < 0 || index > 2)
      return NextResponse.json({ error: "Unknown scene." }, { status: 400 });
    const data = await getFeedData(),
      idea = data.feed.ideas.find((i) => i.id === query.get("idea"));
    const scene = idea?.scenes[index];
    if (!scene || scene.type !== "gif")
      return NextResponse.json(
        { error: "GIF preview not found." },
        { status: 404 },
      );
    return new NextResponse(new Uint8Array(await gifPreview(scene.src)), {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "This reference could not be prepared for playback." },
      { status: 500 },
    );
  }
}
