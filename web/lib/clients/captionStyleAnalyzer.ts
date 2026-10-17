import { isMockMode } from "./mockMode";
import { extractReelText } from "./reelTextExtractor";
import { db } from "@/lib/db/client";
import { trendItems } from "@/lib/db/schema";
import { extractFrames } from "@/lib/render/frames";
import { get } from "@/lib/storage";
import { eq } from "drizzle-orm";

const MODEL = "anthropic/claude-haiku-4.5"; // same model already used for copywriting/persona profiling elsewhere

export type CaptionPosition = "top" | "middle" | "bottom";
export type CaptionSize = "small" | "medium" | "large" | "huge";

export interface CaptionStyle {
  position: CaptionPosition | null;
  size: CaptionSize | null;
  hasBackground: boolean | null;
}

const PROMPT = `Look at this single video thumbnail from a social reel. It may have on-screen caption/hook text burned into the frame (the creator's own big bold text overlay, NOT UI chrome like a timestamp or logo).

Return ONLY a JSON object:
{
  "hasCaption": boolean, // true only if there is clearly a large, deliberate caption/hook text overlay
  "position": "top" | "middle" | "bottom" | null, // where the MAIN caption text block sits vertically in the frame; null if hasCaption is false
  "size": "small" | "medium" | "large" | "huge" | null, // how large the caption text is relative to the frame height (huge = takes up a large portion of the frame width/height, small = a modest line of text); null if hasCaption is false
  "hasBackground": boolean | null // true if the text sits on a solid/rounded background box/pill; false if it's plain text over the video; null if hasCaption is false
}`;

/**
 * Reads where/how big a specific reel's OWN on-screen caption actually is,
 * straight off its thumbnail — this is the real fix for remixes always
 * rendering their caption at one fixed position/size regardless of which
 * source reel they came from (confirmed live: "text placement is really
 * lacking... the main hook is text with same size, placement, font"). A
 * single vision call, same pattern/cost as scripts/profilePersonas.ts
 * (fractions of a cent per image).
 *
 * Returns { position: null, size: null } on any failure or when no clear
 * caption is found — callers fall back to the existing role-based default
 * in that case, this never throws.
 */
/**
 * `ok: false` means the analysis itself never really happened (no API key,
 * an HTTP error, a network failure) — NOT a real "no caption on this
 * frame" answer. Confirmed live this distinction was missing and caused a
 * real, hard-to-spot bug: a vision call that failed only because of a
 * then-broken TLS config (see fetch-original's sourceVideoIsMock fix, same
 * root cause) got caught, returned null/null, and — because
 * ensureCaptionStyleAnalyzed couldn't tell a failure from a genuine "this
 * reel has no on-screen caption" — got cached as permanent fact, silently
 * poisoning that item's render style forever even after the underlying
 * network issue was fixed. `ok: true` with hasCaption:false is a real,
 * cacheable model answer; anything else is transient and must be retried.
 */
async function analyzeCaptionStyleWithStatus(thumbnailUrl: string): Promise<{ style: CaptionStyle; ok: boolean }> {
  if (isMockMode()) {
    // Deterministic mock: a plausible non-default style so mock-mode
    // testing can still exercise the position/size-varying render path.
    return { style: { position: "middle", size: "large", hasBackground: false }, ok: true };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { style: { position: null, size: null, hasBackground: null }, ok: false };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: thumbnailUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { style: { position: null, size: null, hasBackground: null }, ok: false };
    const data = await res.json();
    const rawText: string = data.choices?.[0]?.message?.content ?? "{}";
    // Same markdown-fence-stripping quirk documented in productCopywriter.ts.
    const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(text);
    if (!parsed.hasCaption) return { style: { position: null, size: null, hasBackground: null }, ok: true };
    const position: CaptionPosition | null = ["top", "middle", "bottom"].includes(parsed.position)
      ? parsed.position
      : null;
    const size: CaptionSize | null = ["small", "medium", "large", "huge"].includes(parsed.size) ? parsed.size : null;
    const hasBackground: boolean | null = typeof parsed.hasBackground === "boolean" ? parsed.hasBackground : null;
    return { style: { position, size, hasBackground }, ok: true };
  } catch {
    return { style: { position: null, size: null, hasBackground: null }, ok: false };
  }
}

export async function analyzeCaptionStyle(thumbnailUrl: string): Promise<CaptionStyle> {
  return (await analyzeCaptionStyleWithStatus(thumbnailUrl)).style;
}

/**
 * Lazy-analyze-once-and-cache-in-DB, shared by every render path instead
 * of each one duplicating the same check — confirmed live this was the
 * actual gap for manual_viral reels: generate-persona/route.ts already had
 * this exact logic inline, but generate-artifact-remix (both the eager
 * route and its Inngest sibling) never called it at all, so an artifact
 * remix always fell back to ClipShot's hardcoded "bottom" default even
 * once a reel's real thumbnailUrl existed. That thumbnailUrl only exists
 * for manual_viral reels after the admin explicitly fetches it (real
 * ~$0.075 Apify cost, see /api/trend-items/[id]/fetch-original) — this
 * never triggers that fetch itself, it only analyzes a thumbnail that's
 * already there, so it stays free and never spends anything on its own.
 */
export async function ensureCaptionStyleAnalyzed(trendItem: {
  id: string;
  thumbnailUrl: string | null;
  sourceVideoUrl: string | null;
  captionPosition: CaptionPosition | null;
  captionSize: CaptionSize | null;
  captionHasBackground: boolean | null;
  captionStyleCheckedAt: Date | null;
}): Promise<CaptionStyle> {
  if (trendItem.captionStyleCheckedAt) {
    return {
      position: trendItem.captionPosition,
      size: trendItem.captionSize,
      hasBackground: trendItem.captionHasBackground,
    };
  }

  let style: CaptionStyle = { position: null, size: null, hasBackground: null };
  let ok = false;

  // Prefer the real downloaded video's own frames over thumbnailUrl —
  // confirmed live that Apify's thumbnailUrl (Instagram's own auto-picked
  // cover frame) can be a completely unrelated image with no caption on it
  // at all (a Mr. Bean cartoon cover on a reel whose actual content was a
  // "sent to hell" meme with a real caption box). This applies regardless
  // of how the caption text itself was set (fetched or pasted by an
  // admin) — position/size correctness shouldn't depend on which of those
  // two paths was used, since both leave a real video downloaded once
  // fetch-original has run at all.
  if (trendItem.sourceVideoUrl) {
    try {
      const key = trendItem.sourceVideoUrl.split("/").pop()!;
      const buffer = await get("source-videos", key);
      const frames = await extractFrames(buffer, [0.2, 1.5, 3, 5]);
      const extracted = await extractReelText(frames);
      style = {
        position: extracted.result.position,
        size: extracted.result.size,
        hasBackground: extracted.result.hasBackground,
      };
      ok = extracted.ok;
    } catch {
      ok = false;
    }
  } else if (trendItem.thumbnailUrl) {
    const analyzed = await analyzeCaptionStyleWithStatus(trendItem.thumbnailUrl);
    style = analyzed.style;
    ok = analyzed.ok;
  } else {
    return {
      position: trendItem.captionPosition,
      size: trendItem.captionSize,
      hasBackground: trendItem.captionHasBackground,
    };
  }

  // A failed analysis (network error, no key, bad response) is never
  // written as "checked" — only a real answer (even a genuine "no caption
  // here") gets cached, so a transient failure is retried next time
  // instead of permanently sticking as null/null.
  if (!ok) return style;
  await db
    .update(trendItems)
    .set({
      captionPosition: style.position,
      captionSize: style.size,
      captionHasBackground: style.hasBackground,
      captionStyleCheckedAt: new Date(),
    })
    .where(eq(trendItems.id, trendItem.id));
  return style;
}
