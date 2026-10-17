import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

export interface BrandAnalysis {
  identity: string;
  toneOfVoice: string;
  targetSegments: string[];
  colors: string[];
}

const MODEL = "anthropic/claude-haiku-4.5";

/** Strips tags/scripts/styles down to visible text — same rough approach
 * as lib/clients/productCatalog.ts's stripHtml, duplicated rather than
 * imported since this one also needs to keep title/meta-description text
 * that stripHtml's body_html use case doesn't care about. */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Real frequency scan of the site's own linked CSS — not a proper palette
 * extraction algorithm (no clustering, no perceptual distance), just the
 * most-common non-grayscale hex codes across the first few stylesheets.
 * Good enough to surface a real brand's real palette without an AI call;
 * genuinely wrong for sites that lean on a CSS framework's default colors
 * rather than brand-specific ones. */
async function extractColorsFromSite(domain: string, html: string): Promise<string[]> {
  const linkMatches = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)];
  const hrefs = linkMatches.map((m) => m[1]).slice(0, 4);

  let cssText = "";
  for (const href of hrefs) {
    const url = href.startsWith("http") ? href : href.startsWith("//") ? `https:${href}` : new URL(href, `https://${domain}`).toString();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) cssText += await res.text();
    } catch {
      // one unreachable/blocked stylesheet shouldn't fail the whole scan
    }
  }

  const hexMatches = cssText.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const GRAYSCALE = new Set(["ffffff", "000000", "fefefe", "f9f9f9", "fafafa", "eeeeee", "cccccc", "aaaaaa", "999999", "333333", "111111"]);
  const freq = new Map<string, number>();
  for (const hex of hexMatches) {
    const normalized = hex.toLowerCase();
    if (GRAYSCALE.has(normalized.slice(1))) continue;
    freq.set(normalized, (freq.get(normalized) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([hex]) => hex);
}

/**
 * Real site-level analysis for the Brand Profile page's "Re-scan site"
 * action: identity + tone of voice + target segments (one AI read of the
 * real homepage text) and a real color scan of the site's own CSS (free,
 * no AI). MOCK_MODE reads a hand-built fixture for the AI part and skips
 * the network entirely for colors too — same "no real network calls in
 * mock mode regardless of cost" discipline as fetchShopifyProducts.
 */
export async function analyzeBrandSite(domain: string): Promise<BrandAnalysis> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "brand", "sample-analysis.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf-8"));
    return { ...fixture, colors: ["#c9a66b", "#688f71", "#a9483d", "#f3eadd"] };
  }

  const res = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`could not fetch https://${domain}: ${res.status}`);
  const html = await res.text();
  const text = stripHtmlToText(html).slice(0, 4000);

  const colors = await extractColorsFromSite(domain, html);

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const prompt = `Read this brand's real homepage text below and infer three things, grounded only in what's actually implied by the copy — do not invent facts about the company.

Homepage text: """${text}"""

Return ONLY a JSON object:
{
  "identity": string,        // one sentence: what the brand is and who it's for
  "toneOfVoice": string,     // one sentence describing how it writes/talks
  "targetSegments": string[] // 2-4 short audience segments, e.g. "Urban professionals, 25-40"
}`;

  const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!apiRes.ok) throw new Error(`OpenRouter brand-analysis call failed: ${apiRes.status} ${await apiRes.text()}`);
  const data = await apiRes.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "{}";
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    identity: parsed.identity,
    toneOfVoice: parsed.toneOfVoice,
    targetSegments: parsed.targetSegments ?? [],
    colors,
  };
}
