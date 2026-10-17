import { NextResponse } from "next/server";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { put } from "@/lib/storage";
import { mutateFeed } from "@/lib/brand-feed/store";
import { mediaType } from "@/lib/brand-feed/planner";
import type { ReelKind, ReelSource } from "@/lib/brand-feed/types";

export async function POST(request: Request) {
  try {
    const brand = await getOrCreateCurrentBrand();
    const form = await request.formData(),
      file = form.get("file"),
      kind = form.get("kind");
    const title = String(form.get("title") || "")
      .trim()
      .slice(0, 130);
    if (!(file instanceof File) || !title)
      throw new Error("Add a reference title and a media file.");
    if (!["trend", "viral", "product"].includes(String(kind)))
      throw new Error("Choose a reference type.");
    if (form.get("rights") !== "true")
      throw new Error(
        "Confirm that you have permission to use this reference.",
      );
    if (file.size > 32 * 1024 * 1024 || !file.size)
      throw new Error("Use a file under 32 MB.");
    const extensions: Record<string, string> = {
      "video/mp4": "mp4",
      "video/webm": "webm",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = extensions[file.type];
    if (!ext) throw new Error("Use MP4, WebM, GIF, JPG, PNG or WebP.");
    const id = crypto.randomUUID(),
      src = await put(
        "viral-trend-artifacts",
        id + "." + ext,
        Buffer.from(await file.arrayBuffer()),
      );
    const sample: ReelSource = {
      id,
      kind: kind as ReelKind,
      title,
      caption: title,
      sourceUrl: null,
      thumbnailUrl: mediaType(src) === "video" ? null : src,
      media: [{ id, src, type: mediaType(src) }],
      ready: true,
      uploadedSample: true,
    };
    await mutateFeed(brand.id, (feed) => {
      feed.samples.unshift(sample);
    });
    return NextResponse.json({ sample }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Reference upload failed.",
      },
      { status: 400 },
    );
  }
}
