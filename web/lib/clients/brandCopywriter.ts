import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";
import type { ProductSlotValues } from "./productCopywriter";

const MODEL = "anthropic/claude-haiku-4.5"; // same model/endpoint as productCopywriter.ts

/**
 * Brand-level equivalent of generateProductSlotValues — same four-slot
 * shape, but grounded in the brand's own identity/tone/segments (from
 * POST /api/brand/analyze) instead of a specific product's description.
 * Powers the "remix my brand in general" picker option: no product
 * involved, {product} in the skeleton template is filled with the brand
 * name itself (e.g. "GloVibe. Link in bio.").
 */
export async function generateBrandSlotValues(brand: {
  name: string;
  identity: string | null;
  toneOfVoice: string | null;
  targetSegments: string[] | null;
}): Promise<ProductSlotValues> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "copywriter", "sample-brand-slot-values.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.by_name[brand.name] ?? raw.by_name._default;
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const prompt = `You are writing short caption lines for a social media remix that speaks for a BRAND as a whole, not any single product — grounded strictly in the brand identity below. Do not invent specific product names, ingredients, or claims that aren't implied by the identity — this is a skincare/beauty brand and false claims are a real legal risk.

Brand: ${brand.name}
Identity: """${brand.identity ?? ""}"""
Tone of voice: """${brand.toneOfVoice ?? ""}"""
Target audience: ${(brand.targetSegments ?? []).join(", ") || "unknown"}

Write like the on-screen caption text of a real viral reel, not a marketing sentence — short, punchy, conversational, the kind of line that fits in giant bold text on a phone screen in one or two short lines. NOT a full explanatory clause tacked on with "the same way..." or "because...". Every line must be under 45 characters — that's a hard limit, not a suggestion; a longer line will get visually crushed into a tiny font on screen.

Return ONLY a JSON object with these four lines (each under 45 characters), about the BRAND overall:
{
  "payoff": string,    // the short benefit/result line the brand delivers, e.g. "Finally, skincare with nothing to hide."
  "fact": string,       // a true-to-identity micro-fact about the brand's approach, for a "did you know" hook — this gets appended after "Did you know? " so keep it especially short
  "objection": string, // a plausible skeptical reaction someone might have before trying the brand
  "thing": string       // what someone would say they "wish they knew" about this brand sooner
}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter brand-copywriter call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "{}";
  // Same defensive fence-stripping as productCopywriter.ts — confirmed live
  // there that response_format:json_object doesn't stop this model from
  // wrapping output in a markdown code fence.
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(text);

  return {
    payoff: parsed.payoff,
    fact: parsed.fact,
    objection: parsed.objection,
    thing: parsed.thing,
  };
}
