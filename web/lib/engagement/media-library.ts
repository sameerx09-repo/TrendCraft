import { signedMediaPath } from "@/lib/auth/media-signature";
import "server-only";
import { stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, remixedScripts } from "@/lib/db/schema";
import { readMediaState } from "./media-store";
import {
  publicMediaBase,
  mediaTargetIssue,
  instagramPostUrl,
} from "./media-policy";
import type { EngagementMedia, EngagementMediaLibrary } from "./media-types";
import type { Goal } from "./realPreview";

const LABELS: Record<string, string> = {
  ai_ugc: "AI UGC",
  product_ad: "Product ad",
  product_edit: "Product video",
  brand_feed_remix: "Brand remix",
  campaign_remix: "Trend remix",
};
export async function storedVideoAvailable(url: string) {
  if (
    !/^\/storage\/(rendered-posts|talking-head-videos)\/[a-zA-Z0-9_-]+\.(mp4|webm|mov)$/i.test(
      url,
    )
  )
    return false;
  try {
    const file = await stat(path.join(process.cwd(), url.slice(1)));
    return file.isFile() && file.size > 0;
  } catch {
    return false;
  }
}
export async function engagementMediaLibrary(
  brandId: string,
): Promise<EngagementMediaLibrary> {
  const [state, rows] = await Promise.all([
    readMediaState(brandId),
    db
      .select({ post: posts, script: remixedScripts })
      .from(posts)
      .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
      .where(
        and(
          eq(posts.brandProfileId, brandId),
          ne(posts.status, "discarded"),
          isNotNull(posts.renderedFileUrl),
        ),
      )
      .orderBy(desc(posts.updatedAt)),
  ]);
  const generated: EngagementMedia[] = rows.map(({ post, script }) => ({
    id: "post-" + post.id,
    kind: "generated",
    title: script.hook || script.tags?.[0] || "Created video",
    videoUrl: post.renderedFileUrl!,
    thumbnailUrl: "/storage/rendered-posts/" + post.id + "-poster.jpg",
    label: LABELS[script.hookType || ""] || "Reel remix",
    reviewStatus: post.status === "kept" ? "kept" : "pending",
    publishedUrl: state.publishedLinks["post-" + post.id] || "",
    createdAt: post.createdAt.toISOString(),
  }));
  const uploaded = state.uploads.map((item) => ({
    ...item,
    publishedUrl: state.publishedLinks[item.id] || "",
  }));
  const items = [...generated, ...uploaded];
  const checked = await Promise.all(
    items.map(async (item) =>
      (await storedVideoAvailable(item.videoUrl)) ? item : null,
    ),
  );
  return {
    items: checked
      .filter((item): item is EngagementMedia => item !== null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    publicMediaAvailable: !!publicMediaBase(
      process.env.ENGAGEMENT_PUBLIC_BASE_URL,
    ),
  };
}
export async function campaignMediaTarget(
  brandId: string,
  input: {
    mediaId?: string;
    expectedVideoUrl?: string;
    reelUrl: string;
    goals: Goal[];
  },
) {
  const library = await engagementMediaLibrary(brandId);
  const media = input.mediaId
    ? library.items.find((item) => item.id === input.mediaId) || null
    : null;
  if (input.mediaId && !media)
    throw new Error(
      "This video is unavailable or does not belong to your brand.",
    );
  if (media && input.expectedVideoUrl !== media.videoUrl)
    throw new Error(
      "This video changed. Reload it and review the current version before launching.",
    );
  const issue = mediaTargetIssue({
    goals: input.goals,
    reelUrl: input.reelUrl,
    media,
    publicMediaAvailable: library.publicMediaAvailable,
  });
  if (issue) throw new Error(issue);
  const publishedUrl = instagramPostUrl(input.reelUrl) || "";
  const base = publicMediaBase(process.env.ENGAGEMENT_PUBLIC_BASE_URL);
  const assetUrl =
    media && base ? new URL(signedMediaPath(media.videoUrl), base).href : null;
  return { media, publishedUrl, referenceUrl: assetUrl || publishedUrl };
}
