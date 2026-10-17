import { isMockMode } from "./mockMode";

const MODEL = "anthropic/claude-haiku-4.5"; // same model/endpoint as productCopywriter.ts

/**
 * Replaces fillSkeleton + generateRemixVoice + generateParodyHook +
 * distributeBeatsAcrossClips as the one path that decides what a remix's
 * on-screen text actually says. That four-piece stack was audited live and
 * confirmed to be exactly what it looked like — four separate patches, each
 * added in response to whatever the previous complaint was, never
 * redesigned as a whole:
 *   1. fillSkeleton: mad-libs a fixed 3-line template ("{authority} told me
 *      this...") regardless of what the real reel's own caption says.
 *   2. generateRemixVoice: LLM-fills just the {authority}/{age} slots
 *      inside that same fixed template.
 *   3. generateParodyHook: LLM overrides beat 0 on TOP of the fill above,
 *      once a real caption exists — the actual grounding, bolted onto a
 *      template it was working around rather than replacing.
 *   4. distributeBeatsAcrossClips: re-groups the resulting fixed 3 lines
 *      after the fact to fit however many real clips actually exist.
 *
 * This does it in one call: ask for exactly as many lines as there are
 * real clips, grounded directly in the real caption when there is one, so
 * a single-clip reel gets one honest line instead of 3 lines invented to
 * fill a template built for a different clip count.
 */
export async function generateReelCopy(input: {
  subjectName: string;
  subjectDescription: string;
  /** How many real visual clips this remix actually has — the returned
   * array always has exactly this many lines. No separate distribution
   * step needed afterward. */
  clipCount: number;
  /** The source reel's real caption/hook, when known. Grounds both the
   * content AND the structure (a single-line reaction-meme caption should
   * produce a single-line remix, not an invented 3-part ad). */
  realCaption: string | null;
  /** Only used as loose creative direction when realCaption is null — a
   * corpus-matched format name/example, never literally filled into a
   * template. */
  skeletonHint?: { name: string; example: string };
}): Promise<string[]> {
  const { subjectName, subjectDescription, clipCount, realCaption, skeletonHint } = input;
  const n = Math.max(1, clipCount);

  if (isMockMode()) {
    // Deterministic, free, not real captured LLM output — plain code, not
    // a fixture claiming otherwise. Varies by subject so mock-mode testing
    // isn't just one repeated string across every remix (the exact bug
    // this whole redesign exists to fix).
    const lines = [
      `When ${subjectName} actually works, 3 days in a row`,
      `Real results, not just a promise.`,
      `${subjectName}. Link in bio.`,
    ];
    return Array.from({ length: n }, (_, i) => lines[Math.min(i, lines.length - 1)]);
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const structureNote =
    n === 1
      ? "Since there is only one visual clip, distill this into ONE line that captures the same joke/hook as the original — do not invent a multi-part ad structure the original doesn't have."
      : `Structure the ${n} lines like a short real ad: start with a hook that mirrors the original's tone, then a genuine benefit grounded in the real description below, then end with a clear, simple call to action naming ${subjectName}. (If there are more than 3 lines, keep repeating that hook/benefit/CTA rhythm.)`;

  const prompt = realCaption
    ? `The original viral reel's real on-screen caption is: """${realCaption}"""

Write exactly ${n} new caption line(s) for a remix of this reel, for ${subjectName} (${subjectDescription}).

${structureNote}

This is a parody/adaptation of a real viral format, not a generic rewrite — someone who saw the original should recognize the same joke shape. Ground every claim in the real description above — no fabricated claims, no invented named experts or credentials.

Return ONLY a JSON array of exactly ${n} short strings (each under ~45 characters so it reads as bold on-screen text), nothing else — e.g. ["line one", "line two"].`
    : `No real caption is available for this reel${
        skeletonHint ? ` — but it's been identified as using a "${skeletonHint.name}" format (a real proven viral pattern, e.g.: "${skeletonHint.example}")` : ""
      }.

Write exactly ${n} caption line(s) for ${subjectName} (${subjectDescription})${skeletonHint ? ", loosely in the spirit of that format" : ""}.

${structureNote}

Ground every claim in the real description above — no fabricated claims, no invented named experts or credentials, and never reference a specific original caption since none is available.

Return ONLY a JSON array of exactly ${n} short strings (each under ~45 characters), nothing else — e.g. ["line one", "line two"].`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter reel-copywriter call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "[]";
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  let lines: unknown;
  try {
    lines = JSON.parse(text);
  } catch {
    // Same defensive fallback as everywhere else in this app that parses
    // model JSON — never crash the whole remix over a malformed response.
    lines = [text];
  }
  if (!Array.isArray(lines) || lines.length === 0) lines = [String(text)];

  const strings = (lines as unknown[]).map((l) => String(l));
  // Pad or trim to exactly n — the model is asked for exactly n but isn't
  // guaranteed to comply; the render pipeline needs exactly one caption
  // per real clip, not "approximately".
  if (strings.length > n) return strings.slice(0, n);
  while (strings.length < n) strings.push(strings[strings.length - 1]);
  return strings;
}
