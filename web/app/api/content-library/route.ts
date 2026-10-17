import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { computePercentileRanks } from "@/lib/scoring/percentile";
import { eq, desc, asc, sql } from "drizzle-orm";

/** Matched-skeleton items first (they're the only ones actually actionable
 * for remixing — the rest just sit inert until a new skeleton catches
 * them), then ranked by real performance, not recency — a proven 45M-play
 * instance is worth more than an unproven fresh one. See the "Recent" and
 * "Unused" sorts below for when recency/novelty is actually what's wanted. */
const SORTS = {
  match: [
    desc(sql`case when jsonb_array_length(coalesce(${trendItems.matchedSkeletons}, '[]'::jsonb)) > 0 then 1 else 0 end`),
    desc(sql`coalesce(${trendItems.viewCount}, 0)`),
  ],
  views: [desc(sql`coalesce(${trendItems.viewCount}, 0)`)],
  // Real Instagram/YouTube post date only — NOT coalesced to scrapedAt.
  // Confirmed live this was a real bug: items with no postedAt (fake
  // fixture rows, a few not-yet-backfilled ones) were outranking items with
  // a genuine, known-older postedAt, because their scrapedAt happened to be
  // more recent — unknown dates masquerading as "most recent." NULLS LAST
  // means unknown-date items sort to the bottom instead.
  recent: [sql`${trendItems.postedAt} DESC NULLS LAST`],
  // Surfaces reels nobody's remixed yet first — a "what's new to try" view,
  // distinct from a general trending/performance ranking.
  unused: [asc(trendItems.remixCount), desc(sql`coalesce(${trendItems.viewCount}, 0)`)],
} as const;
type SortKey = keyof typeof SORTS;

/** Same TTL-cache shape as getOrCreateCurrentBrand's — this endpoint's own
 * query (not the brand lookup, which was already cached) turned out to be
 * the real remaining cost: measured live at a consistent 2-2.8s per
 * request even with a warm connection pool, apparently genuine round-trip
 * latency to the hosted Supabase instance for a 521-row scan + sort, not a
 * reconnect cost. The data itself only changes on scrape/remix events, not
 * from a user merely navigating in and out of this page, so a short cache
 * keyed by (brand, sort) makes repeat visits within the window instant
 * instead of re-paying that ~2s every time — same tradeoff already made
 * for the brand row, see lib/db/getOrCreateBrand.ts for the reasoning on
 * why a short TTL beats both "no cache" and "cache forever" here. */
const globalForLibraryCache = globalThis as unknown as {
  libraryCache?: Map<string, { body: unknown; expiresAt: number }>;
};
const CACHE_TTL_MS = 15_000;
function getLibraryCache() {
  if (!globalForLibraryCache.libraryCache) globalForLibraryCache.libraryCache = new Map();
  return globalForLibraryCache.libraryCache;
}

/**
 * Real Content Library backend — replaces the mockup's client-side
 * computeRemixMap(), which cross-referenced FEED/P by title+handle at
 * render time. remixCount/lastRemixedAt are real columns here (maintained
 * by the remix step, once that's built), so "Used xN" is a plain field
 * read, not a live join (D4).
 */
export async function GET(req: Request) {
  const brand = await getOrCreateCurrentBrand();
  const sortParam = new URL(req.url).searchParams.get("sort");
  const sortKey: SortKey = sortParam && sortParam in SORTS ? (sortParam as SortKey) : "match";

  const cacheKey = `${brand.id}:${sortKey}`;
  const cache = getLibraryCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.body);
  }

  // Select only what the Content Library UI actually renders — a bare
  // select() was returning all 35 columns (including `caption`, a verbatim
  // duplicate of `title`, and `hashtags`, unused here), measured live at
  // 2.9s/1.18MB for the full 523-row table vs 0.8s for this projection.
  const items = await db
    .select({
      id: trendItems.id,
      platform: trendItems.platform,
      handle: trendItems.handle,
      title: trendItems.title,
      sourceUrl: trendItems.sourceUrl,
      thumbnailUrl: trendItems.thumbnailUrl,
      postedAt: trendItems.postedAt,
      hookLine: trendItems.hookLine,
      matchedSkeletons: trendItems.matchedSkeletons,
      viewCount: trendItems.viewCount,
      durationSeconds: trendItems.durationSeconds,
      finalScore: trendItems.finalScore,
      remixCount: trendItems.remixCount,
      unscored: trendItems.unscored,
    })
    .from(trendItems)
    .where(eq(trendItems.brandProfileId, brand.id))
    .orderBy(...SORTS[sortKey]);

  // Percentile-rank normalization (D1) — see lib/scoring/percentile.ts for
  // why this ranks against the whole brand corpus, not strictly "the
  // current batch." Items with no score yet (unscored) keep percentile null.
  const scoredIndices = items.map((i, idx) => (i.finalScore != null ? idx : -1)).filter((idx) => idx >= 0);
  const ranks = computePercentileRanks(scoredIndices.map((idx) => items[idx].finalScore as number));
  const percentileById = new Map<string, number>();
  scoredIndices.forEach((idx, i) => percentileById.set(items[idx].id, ranks[i]));

  const itemsWithPercentile = items.map((item) => ({
    ...item,
    percentileScore: percentileById.get(item.id) ?? null,
  }));

  // Display-only dedup for same-creator reposts (confirmed real, e.g.
  // @tycotech.ca posting the identical video+caption as two separate
  // Instagram posts weeks apart). This never touches the database: the
  // page's own promise is "nothing here ever gets deleted, only added to,"
  // so `total`/`remixedAtLeastOnce`/`neverUsed` below still reflect the
  // full, real scraped count — only the rendered grid is deduped.
  //
  // Keeps the FIRST occurrence per (handle, normalized caption) and drops
  // the rest. `items` is already ordered by whatever sort was requested, so
  // "first occurrence" is automatically "the best copy for this sort" —
  // an earlier version instead kept whichever duplicate had the most views
  // but left it at the first occurrence's array position, which could drag
  // a duplicate with a totally different postedAt into that slot and
  // visibly break the "Recent" ordering. Order-preserving dedup avoids that
  // by construction, for every sort mode, with no per-sort special-casing.
  const normalize = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const seenKeys = new Set<string>();
  const deduped: (typeof itemsWithPercentile)[number][] = [];
  for (const item of itemsWithPercentile) {
    const norm = normalize(item.title);
    const key = norm && item.handle ? `${item.handle}::${norm}` : null;
    if (key && seenKeys.has(key)) continue;
    if (key) seenKeys.add(key);
    deduped.push(item);
  }

  const body = {
    total: items.length,
    remixedAtLeastOnce: items.filter((i) => i.remixCount > 0).length,
    neverUsed: items.filter((i) => i.remixCount === 0).length,
    items: deduped,
  };
  cache.set(cacheKey, { body, expiresAt: Date.now() + CACHE_TTL_MS });
  return NextResponse.json(body);
}
