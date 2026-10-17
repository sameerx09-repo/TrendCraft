import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

export interface RawYoutubeVideo {
  id: string;
  snippet: { title: string; channelTitle: string; publishedAt: string; categoryId: string };
  statistics: { viewCount: string; likeCount: string; commentCount: string };
  contentDetails: { duration: string }; // ISO 8601, e.g. "PT58S"
}

/** ISO 8601 duration ("PT1M5S") -> seconds. Shorts are capped at 180s
 * (needs_deep_dive.md C1 — the limit moved from 60s to 3min in Oct 2024). */
export function parseIsoDurationSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

/**
 * Trending pull — cheap (1 quota unit per needs_deep_dive.md C3), safe to
 * call freely. MOCK_MODE reads the hand-built fixture (no real
 * YOUTUBE_API_KEY available this session — label stays honest in the
 * fixture file itself).
 */
export async function fetchTrendingVideos(regionCode = "IN", categoryId = "26"): Promise<RawYoutubeVideo[]> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "youtube", "sample-trending.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.items as RawYoutubeVideo[];
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", regionCode);
  url.searchParams.set("videoCategoryId", categoryId);
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`YouTube trending fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.items as RawYoutubeVideo[];
}

/**
 * Keyword search — the constrained resource (needs_deep_dive.md C3: ~100
 * search.list calls/day). search.list returns IDs only; hydrate via a
 * second videos.list call for statistics/duration. Caller is responsible
 * for rationing (a daily counter is a real Phase-1-hardening task, not
 * built here — see phase1_phase2_build_tasklist.md).
 */
export async function searchShorts(query: string, regionCode = "IN"): Promise<RawYoutubeVideo[]> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "youtube", "sample-trending.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.items as RawYoutubeVideo[];
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("videoDuration", "short"); // pre-filter only, NOT a real Shorts flag (C1)
  searchUrl.searchParams.set("regionCode", regionCode);
  searchUrl.searchParams.set("order", "viewCount");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("maxResults", "50");
  searchUrl.searchParams.set("key", key);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) throw new Error(`YouTube search failed: ${searchRes.status} ${await searchRes.text()}`);
  const searchData = await searchRes.json();
  const ids: string[] = searchData.items.map((item: { id: { videoId: string } }) => item.id.videoId);
  if (ids.length === 0) return [];

  const hydrateUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  hydrateUrl.searchParams.set("id", ids.join(","));
  hydrateUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  hydrateUrl.searchParams.set("key", key);

  const hydrateRes = await fetch(hydrateUrl.toString());
  if (!hydrateRes.ok) throw new Error(`YouTube hydrate failed: ${hydrateRes.status} ${await hydrateRes.text()}`);
  const hydrateData = await hydrateRes.json();

  // Layer 2 of Shorts detection (C1): duration <= 180s. Layer 3 (aspect
  // ratio) needs an unofficial per-video request and is skipped for MVP.
  return (hydrateData.items as RawYoutubeVideo[]).filter(
    (v) => parseIsoDurationSeconds(v.contentDetails.duration) <= 180
  );
}
