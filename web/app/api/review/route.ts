import { NextResponse } from "next/server";
import { legacySource } from "@/lib/mission-control/legacy-source";
import { db } from "@/lib/db/client";
import { posts, remixedScripts, trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { eq, and, desc } from "drizzle-orm";
import { withTtlCache } from "@/lib/db/ttlCache";

const CACHE_TTL_MS = 10_000; // shorter than content-library's 15s — this queue is more decision-driven/interactive

function errorMessage(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("tenant/user") || message.includes("ENOTFOUND") || message.includes("Failed query:")) {
    return "Database connection failed. The configured Supabase DATABASE_URL appears to point to a missing or inactive project.";
  }
  return message || "failed to load review queue";
}

/**
 * Real review queue backend — replaces the mockup's in-memory P array.
 * Returns pending posts joined with their remix content and source trend
 * item, shaped for the review-card UI (hook/slides/beats + score + source
 * title/handle).
 *
 * Split Verdict (the mockup's angle-collision badge, never given a real
 * backend before): flags posts in this same pending batch that share the
 * same remix angle — the same signal the mockup showed, computed for real
 * here instead of client-side.
 */
export async function GET() {
  try {
    const brand = await getOrCreateCurrentBrand();

  return NextResponse.json(
    await withTtlCache("review", brand.id, CACHE_TTL_MS, async () => {
      const rows = await db
        .select({
          post: posts,
          script: remixedScripts,
          trendItem: trendItems,
        })
        .from(posts)
        .innerJoin(remixedScripts, eq(posts.remixedScriptId, remixedScripts.id))
        .leftJoin(trendItems, eq(remixedScripts.trendItemId, trendItems.id))
        .where(and(eq(posts.brandProfileId, brand.id), eq(posts.status, "pending")))
        .orderBy(desc(posts.score));

      const angleCounts = new Map<string, number>();
      for (const row of rows) {
        const angle = row.script.angle ?? "";
        if (!angle) continue;
        angleCounts.set(angle, (angleCounts.get(angle) ?? 0) + 1);
      }

      const rowsWithCollision = rows.map((row) => {
        const angle = row.script.angle ?? "";
        const count = angle ? (angleCounts.get(angle) ?? 0) : 0;
        return { ...row, angleCollisionCount: count > 1 ? count : 0 };
      });

      return { total: rows.length, posts: rowsWithCollision.map(legacySource) };
    })
    );
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}




