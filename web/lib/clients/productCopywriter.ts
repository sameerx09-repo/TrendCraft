import { readFile } from "fs/promises";
import path from "path";
import { isMockMode } from "./mockMode";

export interface ProductSlotValues {
  /** Short benefit/result line — the {payoff} slot in every skeleton. */
  payoff: string;
  /** A genuinely true micro-fact — the {fact} slot in did_you_know. */
  fact: string;
  /** A plausible skeptical reaction — the {objection} slot in skeptic_disarm. */
  objection: string;
  /** What someone would say they "wish they knew" — the {thing} slot in wish_i_knew. */
  thing: string;
}

const MODEL = "anthropic/claude-haiku-4.5"; // confirmed live via GET https://openrouter.ai/api/v1/models before first spend — not assumed from docs

/**
 * The one real model call this pipeline needs. Everything upstream of this
 * (discovery, hook extraction, skeleton matching, catalog sync) is free —
 * this is the single step that turns real Shopify body_html into
 * skeleton-ready caption lines, and it's genuinely a synthesis task, not
 * extraction, so it can't be done with string manipulation like the rest of
 * the pipeline was.
 *
 * Uses OpenRouter (OPENROUTER_API_KEY, already present for the Runway
 * client) rather than the direct Anthropic API in lib/clients/claude.ts,
 * since ANTHROPIC_API_KEY is not set in this environment.
 */
export async function generateProductSlotValues(product: {
  title: string;
  productType: string | null;
  description: string | null;
}): Promise<ProductSlotValues> {
  if (isMockMode()) {
    const fixturePath = path.join(process.cwd(), "fixtures", "copywriter", "sample-slot-values.json");
    const raw = JSON.parse(await readFile(fixturePath, "utf-8"));
    return raw.by_title[product.title] ?? raw.by_title._default;
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const prompt = `You are writing short caption lines for a social media remix, strictly grounded in the real product description below. Do not invent claims, ingredients, or results that are not stated or directly implied by the description — this is a skincare/beauty brand and false claims are a real legal risk.

Product: ${product.title}
Category: ${product.productType ?? "unknown"}
Real description: """${product.description ?? ""}"""

Write like the on-screen caption text of a real viral reel, not a marketing sentence — short, punchy, conversational, the kind of line that fits in giant bold text on a phone screen in one or two short lines. Real examples of the length/tone to match: "My skin has never been this calm.", "Judge me or not, I'm still using this hack", "This changed everything for me". NOT this: a full explanatory clause tacked on with "the same way..." or "because...". Every line must be under 45 characters — that's a hard limit, not a suggestion; a longer line will get visually crushed into a tiny font on screen.

Return ONLY a JSON object with these four lines (each under 45 characters):
{
  "payoff": string,    // the short benefit/result line, e.g. "My skin has never been this calm."
  "fact": string,       // a true micro-fact about the product/ingredient/mechanism, for a "did you know" hook — this gets appended after "Did you know? " so keep it especially short
  "objection": string, // a plausible skeptical reaction someone might have before trying it
  "thing": string       // what someone would say they "wish they knew" about this product
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
  if (!res.ok) throw new Error(`OpenRouter copywriter call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "{}";
  // response_format: json_object did not stop claude-haiku-4.5 (via
  // OpenRouter) from wrapping the JSON in a markdown code fence — confirmed
  // live, contradicting the response_format contract. Strip it defensively
  // rather than trusting the flag.
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(text);

  return {
    payoff: parsed.payoff,
    fact: parsed.fact,
    objection: parsed.objection,
    thing: parsed.thing,
  };
}
