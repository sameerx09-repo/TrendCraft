import { NextResponse } from "next/server";
import { legacySource } from "@/lib/mission-control/legacy-source";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq, and, desc } from "drizzle-orm";

/** Real Export screen backend — every "kept" post, with its render status
 * and file URL once ready. The per-post GET /api/posts/[id]/export exists
 * for a single item; this is the list view. */
export async function GET() {
  const brand = await getOrCreateCurrentBrand();

  const rows = await db
    .select({
      post: posts,
      script: remixedScripts,
      trendItem: trendItems,
    })
    .from(posts)
    .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
    .leftJoin(trendItems, eq(remixedScripts.trendItemId, trendItems.id))
    .where(and(eq(posts.brandProfileId, brand.id), eq(posts.status, "kept")))
    .orderBy(desc(posts.updatedAt));

  return NextResponse.json({ total: rows.length, posts: rows.map(legacySource) });
}
