import { NextResponse } from "next/server";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { engagementMediaLibrary } from "@/lib/engagement/media-library";
import { mutateMediaState } from "@/lib/engagement/media-store";
import {
  instagramPostUrl,
  isTestInstagramUrl,
} from "@/lib/engagement/media-policy";
export async function GET() {
  try {
    const brand = await getOrCreateCurrentBrand();
    return NextResponse.json(await engagementMediaLibrary(brand.id));
  } catch {
    return NextResponse.json(
      { error: "Your video library could not be loaded." },
      { status: 500 },
    );
  }
}
export async function PATCH(request: Request) {
  try {
    const brand = await getOrCreateCurrentBrand(),
      body = await request.json();
    const library = await engagementMediaLibrary(brand.id);
    const item = library.items.find((i) => i.id === body.mediaId);
    if (!item) throw new Error("Choose a video from your brand library.");
    const value =
      typeof body.publishedUrl === "string" ? body.publishedUrl.trim() : "";
    if (isTestInstagramUrl(value))
      throw new Error(
        "Test Instagram links cannot be saved as published posts.",
      );
    const url = value ? instagramPostUrl(value) : "";
    if (value && !url)
      throw new Error("Enter a valid public Instagram reel or post link.");
    await mutateMediaState(brand.id, (state) => {
      if (url) state.publishedLinks[item.id] = url;
      else delete state.publishedLinks[item.id];
    });
    return NextResponse.json({ publishedUrl: url });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The published link could not be saved.",
      },
      { status: 400 },
    );
  }
}
