import { isMockMode } from "./mockMode";
import type { CaptionPosition, CaptionSize } from "./captionStyleAnalyzer";

const MODEL = "anthropic/claude-haiku-4.5"; // same model as captionStyleAnalyzer.ts

const PROMPT = `These are frames sampled across one social media reel/video. Many reels bake their real hook/joke text directly into the video as a big bold text overlay (NOT the post's caption field below it, NOT UI chrome like timestamps, usernames, or logos, NOT watermarks).

Transcribe that on-screen text VERBATIM, exactly as written (same wording, same punctuation). If the text changes across frames (e.g. builds up a sentence), give the fullest/final version. Also report where that text block sits, how large it is, and whether it sits on a solid/rounded background box (the common white-box-black-text meme caption style) versus plain text laid directly over the video with just a stroke/shadow.

Return ONLY a JSON object:
{
  "hasText": boolean,
  "text": string | null, // the verbatim on-screen text, or null if hasText is false
  "position": "top" | "middle" | "bottom" | null, // where the text block sits vertically; null if hasText is false
  "size": "small" | "medium" | "large" | "huge" | null, // how large the text is relative to the frame; null if hasText is false
  "hasBackground": boolean | null // true if the text sits on a solid/rounded background box/pill; false if it's plain text over the video; null if hasText is false
}`;

export interface ReelTextResult {
  text: string | null;
  position: CaptionPosition | null;
  size: CaptionSize | null;
  hasBackground: boolean | null;
}

/**
 * Reads the REAL hook text (and its position/size) baked into a reel's
 * video frames — confirmed live this is a different, often unrelated thing
 * from Apify's `caption` field (the post's text caption below the video):
 * a real reel from @mid_west_meme had on-screen text "When you get sent to
 * hell..." while its actual Instagram caption was just an unrelated
 * Japanese hashtag. Also confirmed live that Apify's `thumbnailUrl` (an
 * Instagram-selected cover frame, used by captionStyleAnalyzer.ts for the
 * auto-scraped Instagram pool) can be a COMPLETELY different, unrelated
 * image with no caption on it at all — for this same reel it was a plain
 * Mr. Bean cartoon, nothing like the actual "hell/bestie" caption frame.
 * Reading text + position + size off the SAME real video frames in one
 * call avoids that mismatch entirely (one vision call, one consistent
 * source image, instead of two calls disagreeing about two different
 * images) — this is what fetch-original's route uses for manual_viral
 * reels, which have a real downloaded video to sample frames from.
 *
 * `ok: false` means the call itself never really happened (no key, a bad
 * response, a network error) — NOT a real "no text here" answer. Callers
 * must not cache an ok:false result as fact (see captionStyleAnalyzer.ts's
 * identical fix) — confirmed live a TLS misconfiguration earlier in this
 * same session caused exactly this failure mode, silently and
 * permanently, until the distinction existed to prevent it.
 */
export async function extractReelText(frames: Buffer[]): Promise<{ result: ReelTextResult; ok: boolean }> {
  const empty: ReelTextResult = { text: null, position: null, size: null, hasBackground: null };
  if (frames.length === 0) return { result: empty, ok: false };

  if (isMockMode()) {
    return { result: empty, ok: true };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { result: empty, ok: false };

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
              ...frames.map((frame) => ({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${frame.toString("base64")}` },
              })),
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { result: empty, ok: false };
    const data = await res.json();
    const rawText: string = data.choices?.[0]?.message?.content ?? "{}";
    // Same markdown-fence-stripping quirk documented in productCopywriter.ts.
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.hasText || typeof parsed.text !== "string" || !parsed.text.trim()) {
      return { result: empty, ok: true };
    }
    const position: CaptionPosition | null = ["top", "middle", "bottom"].includes(parsed.position)
      ? parsed.position
      : null;
    const size: CaptionSize | null = ["small", "medium", "large", "huge"].includes(parsed.size) ? parsed.size : null;
    const hasBackground: boolean | null = typeof parsed.hasBackground === "boolean" ? parsed.hasBackground : null;
    return { result: { text: parsed.text.trim(), position, size, hasBackground }, ok: true };
  } catch {
    return { result: empty, ok: false };
  }
}
