import { NextResponse } from "next/server";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { prepareEngagementUpload } from "@/lib/engagement/prepare-upload";
import { mutateMediaState } from "@/lib/engagement/media-store";
import { put } from "@/lib/storage";
import type { EngagementMedia } from "@/lib/engagement/media-types";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    const brand = await getOrCreateCurrentBrand(),
      form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a video to upload.");
    if (form.get("rights") !== "true")
      throw new Error("Confirm you have permission to use this video.");
    const title = String(form.get("title") || "")
      .trim()
      .slice(0, 160);
    if (!title) throw new Error("Give this video a title.");
    const bytes = await prepareEngagementUpload(file),
      id = crypto.randomUUID();
    const videoUrl = await put(
      "rendered-posts",
      "engagement-upload-" + id + ".mp4",
      bytes.video,
    );
    const thumbnailUrl = await put(
      "rendered-posts",
      "engagement-upload-" + id + ".jpg",
      bytes.poster,
    );
    const item: EngagementMedia = {
      id: "upload-" + id,
      kind: "uploaded",
      title,
      videoUrl,
      thumbnailUrl,
      label: form.get("videoType") === "ugc" ? "Brand UGC" : "Brand reel",
      reviewStatus: "pending",
      publishedUrl: "",
      createdAt: new Date().toISOString(),
    };
    await mutateMediaState(brand.id, (state) => {
      state.uploads.unshift(item);
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
