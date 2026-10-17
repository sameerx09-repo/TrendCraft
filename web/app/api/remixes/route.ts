import { NextResponse } from "next/server";
import { legacySource } from "@/lib/mission-control/legacy-source";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq, desc } from "drizzle-orm";
import { withTtlCache } from "@/lib/db/ttlCache";

const CACHE_TTL_MS = 10_000;

function errorMessage(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("tenant/user") || message.includes("ENOTFOUND") || message.includes("Failed query:")) {
    return "Database connection failed. The configured Supabase DATABASE_URL appears to point to a missing or inactive project.";
  }
  return message || "failed to load remixes";
}

/**
 * The Remixes gallery's real backend — every generated post regardless of
 * status (pending/kept/discarded), not just pending ones. Replaces the old
 * "Review" model where deciding on a post made it disappear from view;
 * real product ask was to retain everything, browsable, status as a
 * filter rather than a vanishing act. /api/review (pending-only) is
 * unchanged and still exists for anything that specifically needs the
 * decision-queue shape.
 */
export async function GET() {
  try {
    const brand = await getOrCreateCurrentBrand();

    return NextResponse.json(
      await withTtlCache("remixes", brand.id, CACHE_TTL_MS, async () => {
        const rows = await db
          .select({ post: posts, script: remixedScripts, trendItem: trendItems })
          .from(posts)
          .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
          .leftJoin(trendItems, eq(remixedScripts.trendItemId, trendItems.id))
          .where(eq(posts.brandProfileId, brand.id))
          .orderBy(desc(posts.createdAt));

        return { total: rows.length, posts: rows.map(legacySource) };
      })
    );
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}



