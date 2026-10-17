import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

/**
 * Matches the REAL apify/instagram-hashtag-scraper payload, captured live
 * (fixtures/apify/sample-scrape.json) — not the original hand-built guess.
 * Notably: there is no videoViewCount field at all; play count is what's
 * available (videoPlayCount / igPlayCount, seen as duplicates of each
 * other in the one real item captured — treat them as the same signal).
 */
export interface RawApifyReelItem {
  id: string;
  shortCode: string;
  url: string;
  caption: string;
  hashtags: string[];
  mentions?: string[];
  ownerUsername: string;
  ownerFullName?: string;
  timestamp: string;
  videoDuration: number;
  videoPlayCount: number;
  igPlayCount?: number;
  likesCount: number;
  commentsCount: number;
  displayUrl: string;
  videoUrl: string;
  productType?: string;
  paidPartnership?: boolean;
  musicInfo?: {
    artist_name: string | null;
    song_name: string;
    uses_original_audio: boolean;
    audio_id: string;
    should_mute_audio?: boolean;
  };
  latestComments?: { text: string; ownerUsername?: string }[];
}

/**
 * On-demand only (needs_deep_dive.md A2 — MVP is not scheduled). MOCK_MODE
 * reads the fixture captured/hand-built in fixtures/apify/ instead of
 * spending real Apify credits on every dev iteration.
 *
 * This is the DISCOVERY step (per the "what's instagram-hashtag-scraper
 * for" conversation) — targets apify/instagram-hashtag-scraper with its
 * real input schema (hashtags[], resultsType, resultsLimit), confirmed
 * against the actor's own input-schema docs. instagram-reel-scraper is a
 * separate, later step (URL-based hydration/transcripts on the finalists
 * only) and is not called from here.
 */
export async function scrapeInstagramReels(hashtags: string[], resultsLimit = 10): Promise<RawApifyReelItem[]> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "apify", "sample-scrape.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.items as RawApifyReelItem[];
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");

  const actorId = process.env.APIFY_INSTAGRAM_ACTOR_ID ?? "apify~instagram-hashtag-scraper";
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hashtags,
        resultsType: "reels",
        resultsLimit,
        // apifyProxyCountry: 'IN' — enable once needs_deep_dive.md A3's
        // India-skew check confirms it's needed.
      }),
    }
  );
  if (!res.ok) throw new Error(`Apify scrape failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RawApifyReelItem[];
}

/**
 * Keyword families for popularity-ranked discovery. NOT brand hashtags —
 * the whole point is sourcing viral reels irrespective of niche and
 * re-skinning them (CROSS_NICHE_DISCOVERY.md).
 *
 * This exact set is measured, not guessed. Against the live corpus the
 * advice/hack family produced clean structural hooks ("A perfumer told me
 * this", "My hairdresser told me this secret") while `motivation` produced
 * junk ("Once again .........", "Try this transition .") despite having ~5x
 * the plays — gym flexing and devotional edits are visually entangled and
 * unusable no matter how viral. Volume is not the selection criterion.
 *
 * Two gotchas found by running it: `lifehack` as one word returns "Empty or
 * private data", but the two-word forms work; and mood/format words
 * (`relatable`, `pov`, `confession`) have no popular feed at all, because
 * Instagram indexes topics rather than formats.
 */
export const DISCOVERY_KEYWORDS = [
  "advice",
  "beauty hack",
  "cleaning hack",
  "kitchen hack",
  "hair hack",
  "home hack",
] as const;

/**
 * DISCOVERY, popularity-ranked. Replaces scrapeInstagramReels for trend
 * sourcing.
 *
 * apify/instagram-hashtag-scraper is RECENCY-ranked — it returns whatever was
 * posted most recently under a tag, which is why it kept handing us 287-play
 * shayari reels. This targets apify/instagram-search-scraper's `popular`
 * mode, backed by the real surface instagram.com/popular/<keyword>, which is
 * popularity-ranked by construction. Measured against the same brand on the
 * same day: median plays went from ~10,000 to ~14,566,000.
 *
 * Input schema (search / searchType / searchLimit) verified against the live
 * actor build schema before first paid call — not inferred from docs prose.
 *
 * Note the actor returns error records inline (one object per keyword that
 * has no popular feed) rather than failing the run; those are filtered here.
 */
export async function discoverPopularReels(
  keywords: readonly string[] = DISCOVERY_KEYWORDS,
  resultsLimit = 40
): Promise<RawApifyReelItem[]> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "apify", "sample-popular.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.items as RawApifyReelItem[];
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-search-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search: keywords.join(","),
        searchType: "popular",
        searchLimit: resultsLimit,
      }),
    }
  );
  if (!res.ok) throw new Error(`Apify popular discovery failed: ${res.status} ${await res.text()}`);

  const items = (await res.json()) as (RawApifyReelItem & { error?: string })[];
  return items.filter((i) => !i.error && i.url);
}

/**
 * Resolves a REAL, freshly-signed video URL for one specific reel permalink
 * — needed because Instagram's CDN video links expire within days, so the
 * videoUrl captured at discovery time is long dead by the time a human
 * reviews and wants to compare it against the remix. Uses
 * apify/instagram-reel-scraper (accepts direct reel URLs, confirmed against
 * its input schema — same actor used for the earlier transcript test),
 * resultsLimit 1, transcript deliberately off since we don't need it here
 * and it's a separate paid add-on.
 *
 * Returns the video bytes directly rather than a URL — the caller
 * (downloadOriginalVideosForComparison) stores them immediately via
 * lib/storage, same pattern as HeyGen's putFromUrl, because this signed URL
 * is also short-lived.
 */
// Was a single fixture file returned for every trendItem regardless of
// which real reel was requested — confirmed live this was actively
// misleading: a real @zapatas_cleaning_services post (cleaning-hacks
// caption, real metadata) showed a Dubai-skyline skincare-brand video next
// to it, because that one file was literally the only thing this function
// could ever return in mock mode. These 5 are real videos this project
// already paid to download during earlier real-spend testing (not fresh
// captures) — cycling through them at least varies what mock mode shows,
// though none of them will match a given trendItem's actual real content;
// only MOCK_MODE=false does that.
const ORIGINAL_VIDEO_FIXTURES = [
  "reel-1-sunscreen.mp4",
  "reel-2-bodylotion.mp4",
  "reel-3-nightcream.mp4",
  "reel-4-perfume.mp4",
  "reel-5-kumkumadi.mp4",
];
let mockOriginalVideoCursor = 0;

export interface OriginalReelFetchResult {
  buffer: Buffer;
  /** Instagram's own real post caption text (RawApifyReelItem.caption) —
   * confirmed live this field was already coming back from the exact same
   * Apify call this function makes, and was silently discarded, keeping
   * only videoUrl. For a manually-pasted reel (no caption ever collected
   * at import time — see viral-trends/import/route.ts) this is a real,
   * reliable source for the caption instead of OCR/vision-reading the
   * on-screen text: it's the actual metadata field, not a guess at what
   * pixels say. null if Apify didn't return one for this post. */
  caption: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
}

export async function fetchOriginalReelVideo(reelUrl: string): Promise<OriginalReelFetchResult> {
  if (isMockMode()) {
    const file = ORIGINAL_VIDEO_FIXTURES[mockOriginalVideoCursor % ORIGINAL_VIDEO_FIXTURES.length];
    mockOriginalVideoCursor++;
    const fixturePath = path.join(process.cwd(), "fixtures", "apify", "original-videos", file);
    return {
      buffer: await readFile(fixturePath),
      // Deterministic mock text, not real captured Apify output — plain
      // string, not disguised as real metadata.
      caption: null,
      handle: null,
      thumbnailUrl: null,
    };
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: [reelUrl], resultsLimit: 1, includeTranscript: false }),
    }
  );
  if (!res.ok) throw new Error(`Apify reel fetch failed: ${res.status} ${await res.text()}`);
  const items = (await res.json()) as Partial<RawApifyReelItem>[];
  const item = items[0];
  const videoUrl = item?.videoUrl;
  if (!videoUrl) throw new Error(`No videoUrl returned for ${reelUrl}`);

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Video CDN fetch failed: ${videoRes.status}`);
  return {
    buffer: Buffer.from(await videoRes.arrayBuffer()),
    caption: item.caption ?? null,
    handle: item.ownerUsername ?? null,
    thumbnailUrl: item.displayUrl ?? null,
  };
}
