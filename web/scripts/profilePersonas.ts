// REAL SPEND — vision classification of every trend-corpus thumbnail, to
// profile who actually appears in the trending reels (gender, age group,
// action, complexion, apparent ethnicity) so persona-library investment can
// be grounded in real range/coverage instead of guesswork. ~$1-2 total
// (claude-haiku-4.5 vision via OpenRouter, ~1.3K tokens/image).
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error("OPENROUTER_API_KEY missing");

const MODEL = "anthropic/claude-haiku-4.5"; // same model already used for copywriting elsewhere in this codebase
const CONCURRENCY = 8;

interface Item {
  id: string;
  handle: string | null;
  thumbnailUrl: string;
}

interface Profile {
  id: string;
  handle: string | null;
  humanPresent: boolean;
  peopleCount: number;
  gender: string;
  ageGroup: string;
  action: string;
  complexion: string;
  ethnicityApparent: string;
  setting: string;
  notes: string;
  error?: string;
}

const PROMPT = `You are helping a video content team catalog the RANGE of people and actions that appear in a library of trending social reels, purely to plan diverse AI persona casting for future content — not to make claims about anyone's actual identity. Describe only visual appearance, broadly and respectfully.

Look at this single video thumbnail frame and return ONLY a JSON object:
{
  "humanPresent": boolean,
  "peopleCount": number,
  "gender": "woman" | "man" | "multiple" | "unclear" | "n/a",
  "ageGroup": "child" | "teen" | "young_adult" | "adult" | "senior" | "unclear" | "n/a",
  "action": string,  // short phrase, what the main person is doing RIGHT NOW in this frame, e.g. "talking to camera", "dancing", "cooking", "walking", "applying product to face", "sitting", "pointing at object". If no clear action, describe the pose.
  "complexion": "fair" | "light" | "medium" | "tan" | "deep" | "unclear" | "n/a",
  "ethnicityApparent": string, // broad visual category, e.g. "South Asian", "East Asian", "Black", "White", "Hispanic/Latino", "Middle Eastern", "Mixed/Ambiguous", "unclear", "n/a"
  "setting": "indoor" | "outdoor" | "unclear",
  "notes": string // anything else useful for persona-casting purposes, under 15 words
}
If there is no human in frame (e.g. just a product, text card, or object), set humanPresent false and use "n/a" for the person fields.`;

async function classifyOne(item: Item): Promise<Profile> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: item.thumbnailUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const rawText: string = data.choices?.[0]?.message?.content ?? "{}";
    const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const p = JSON.parse(text);
    return {
      id: item.id,
      handle: item.handle,
      humanPresent: !!p.humanPresent,
      peopleCount: p.peopleCount ?? 0,
      gender: p.gender ?? "unclear",
      ageGroup: p.ageGroup ?? "unclear",
      action: p.action ?? "unclear",
      complexion: p.complexion ?? "unclear",
      ethnicityApparent: p.ethnicityApparent ?? "unclear",
      setting: p.setting ?? "unclear",
      notes: p.notes ?? "",
    };
  } catch (e) {
    return {
      id: item.id,
      handle: item.handle,
      humanPresent: false,
      peopleCount: 0,
      gender: "error",
      ageGroup: "error",
      action: "error",
      complexion: "error",
      ethnicityApparent: "error",
      setting: "error",
      notes: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const { db } = await import("../lib/db/client");
  const { trendItems } = await import("../lib/db/schema");
  const { isNotNull } = await import("drizzle-orm");

  const rows = await db
    .select({ id: trendItems.id, handle: trendItems.handle, thumbnailUrl: trendItems.thumbnailUrl })
    .from(trendItems)
    .where(isNotNull(trendItems.thumbnailUrl));

  const items = rows.filter((r): r is Item => !!r.thumbnailUrl);
  console.log(`classifying ${items.length} thumbnails, concurrency ${CONCURRENCY}...\n`);

  const results: Profile[] = [];
  let done = 0;
  const queue = [...items];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const profile = await classifyOne(item);
      results.push(profile);
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  writeFileSync(
    path.join(__dirname, "personaProfileResults.json"),
    JSON.stringify(results, null, 2)
  );

  const errors = results.filter((r) => r.error);
  console.log(`\ndone: ${results.length} classified, ${errors.length} errors`);
  console.log("written: scripts/personaProfileResults.json");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
