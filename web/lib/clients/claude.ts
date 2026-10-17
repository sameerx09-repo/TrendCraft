import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

export interface RemixResult {
  remixabilityRating: number; // 1-10, per needs_deep_dive.md D2
  relevanceScore: number; // rating * 10
  extractedHook: string;
  extractedArc: string;
  extractedBeats: string[];
  remix: {
    angle: string;
    hookType: string;
    hook: string;
    arc: string;
    cta: string;
    slides: string[];
    beats: string[];
    caption: string;
    tags: string[];
  };
}

/**
 * MOCK_MODE reads fixtures/claude/sample-scoring-remix.json, keyed by
 * sourceUrl. Real path is a plain Messages API call — no SDK dependency
 * needed for one call shape, keeps this file self-contained.
 */
export async function scoreAndRemix(sourceUrl: string, caption: string, brandName: string): Promise<RemixResult> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "claude", "sample-scoring-remix.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    const entry = raw.by_source_url[sourceUrl] ?? raw.by_source_url._default;
    return {
      remixabilityRating: entry.remixability_rating,
      relevanceScore: entry.relevance_score,
      extractedHook: entry.extracted_hook,
      extractedArc: entry.extracted_arc,
      extractedBeats: entry.extracted_beats,
      remix: {
        angle: entry.remix.angle,
        hookType: entry.remix.hook_type,
        hook: entry.remix.hook,
        arc: entry.remix.arc,
        cta: entry.remix.cta,
        slides: entry.remix.slides,
        beats: entry.remix.beats,
        caption: entry.remix.caption,
        tags: entry.remix.tags,
      },
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const prompt = `You are scoring and remixing a scraped social post for the brand "${brandName}".
Source caption: """${caption}"""

Return ONLY JSON matching this shape:
{
  "remixability_rating": <1-10>,
  "extracted_hook": string,
  "extracted_arc": string,
  "extracted_beats": string[],
  "remix": {
    "angle": string, "hook_type": string, "hook": string, "arc": string, "cta": string,
    "slides": string[], "beats": string[], "caption": string, "tags": string[]
  }
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);

  return {
    remixabilityRating: parsed.remixability_rating,
    relevanceScore: parsed.remixability_rating * 10,
    extractedHook: parsed.extracted_hook,
    extractedArc: parsed.extracted_arc,
    extractedBeats: parsed.extracted_beats,
    remix: {
      angle: parsed.remix.angle,
      hookType: parsed.remix.hook_type,
      hook: parsed.remix.hook,
      arc: parsed.remix.arc,
      cta: parsed.remix.cta,
      slides: parsed.remix.slides,
      beats: parsed.remix.beats,
      caption: parsed.remix.caption,
      tags: parsed.remix.tags,
    },
  };
}
