import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, trendItems } from "@/lib/db/schema";
import { readFeed } from "@/lib/brand-feed/store";
import { readMediaState } from "@/lib/engagement/media-store";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function ownsResource(kind: string, id: string, brandId: string) {
  if (!UUID.test(id)) return false;
  const table =
    kind === "posts" || kind === "product-ads"
      ? posts
      : kind === "scripts"
        ? remixedScripts
        : trendItems;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.brandProfileId, brandId)))
    .limit(1);
  return !!row;
}
export async function ownsAsset(path: string, brandId: string) {
  if (
    !/^\/(storage|brand-feed|runway-clips|viral-trend-clips)\/[a-zA-Z0-9_./-]+$/.test(
      path,
    ) ||
    path.includes("..")
  )
    return false;
  const id = path.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/i)?.[0];
  if (
    id &&
    ((await ownsResource("posts", id, brandId)) ||
      (await ownsResource("trend-items", id, brandId)))
  )
    return true;
  const sourcePath = path.replace(
    /^\/viral-trend-clips\//,
    "/storage/viral-trend-artifacts/",
  );
  const [row] = await db
    .select({ id: trendItems.id })
    .from(trendItems)
    .where(
      and(
        eq(trendItems.brandProfileId, brandId),
        sql`(${trendItems.sourceVideoUrl}=${sourcePath} OR ${trendItems.thumbnailUrl}=${sourcePath} OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(${trendItems.artifacts},'[]'::jsonb)) a WHERE a->>'fileUrl'=${sourcePath}))`,
      ),
    )
    .limit(1);
  if (row) return true;
  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.brandProfileId, brandId),
        sql`(${posts.renderedFileUrl}=${path} OR ${posts.talkingHeadVideoUrl}=${path})`,
      ),
    )
    .limit(1);
  if (post) return true;
  const [state, feed] = await Promise.all([
    readMediaState(brandId),
    readFeed(brandId),
  ]);
  return (
    state.uploads.some((i) => i.videoUrl === path || i.thumbnailUrl === path) ||
    feed.samples.some((s) => s.media.some((m) => m.src === sourcePath))
  );
}
