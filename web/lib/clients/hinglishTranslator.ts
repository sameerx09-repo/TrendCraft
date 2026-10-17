import { isMockMode } from "./mockMode";

const MODEL = "anthropic/claude-haiku-4.5";

/**
 * Real per-post language toggle (Riff mock's Edit modal: English/Hinglish).
 * Unlike generateProductSlotValues, this has no natural fixture — input is
 * whatever a user typed, not one of a fixed set of product titles — so
 * MOCK_MODE can't replay a captured response. Instead it does a small,
 * honestly-approximate word-substitution pass: real code-mixed Hindi-English
 * the way a first-pass casual reel caption might read, good enough to
 * exercise the UI toggle for free, but not the real model output you'd get
 * with MOCK_MODE=false.
 */
const MOCK_SUBSTITUTIONS: [RegExp, string][] = [
  [/\byour\b/gi, "aapka"],
  [/\byou\b/gi, "aap"],
  [/\bis\b/gi, "hai"],
  [/\bare\b/gi, "hain"],
  [/\bthis\b/gi, "yeh"],
  [/\bthat\b/gi, "woh"],
  [/\bno\b/gi, "koi nahi"],
  [/\bwhat\b/gi, "kya"],
  [/\bdo you know\b/gi, "kya aap jaante hain"],
  [/\bskin\b/gi, "skin"],
  [/\bdeserves?\b/gi, "deserve karti hai"],
];

function mockTranslate(line: string): string {
  let out = line;
  for (const [pattern, replacement] of MOCK_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out;
}

export async function translateToHinglish(lines: string[]): Promise<string[]> {
  if (isMockMode()) return lines.map(mockTranslate);

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const prompt = `Rewrite each of these Instagram Reel caption lines into natural Hinglish (casual Hindi-English code-mixing, Latin script, the way a young Indian creator would actually write a caption) — not a literal translation, keep the same meaning and punch. Return ONLY a JSON array of strings, same order, same count as the input.

Input lines:
${JSON.stringify(lines)}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter Hinglish call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "[]";
  // Same defensive strip as generateProductSlotValues — response_format
  // did not reliably stop this model from wrapping output in a code fence.
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(text);
  // The prompt asks for a bare array but response_format:json_object forces
  // an object — models commonly wrap it as {"lines": [...]} or similar.
  const arr = Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray);
  if (!Array.isArray(arr) || arr.length !== lines.length) {
    throw new Error("Hinglish translation returned unexpected shape");
  }
  return arr as string[];
}
