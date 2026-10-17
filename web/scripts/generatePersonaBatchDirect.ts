// Real direct-Runway generation (not via OpenRouter) — used only because the
// OpenRouter key ran out of credits mid-batch (see generatePersonaBatch.ts).
// Request shape confirmed against the account's own prior real scratch tests
// (scratch-persona-clip1.mjs etc): POST /v1/image_to_video, model
// "gen4_turbo", ratio "720:1280". Direct account balance is 153 credits
// (~4 clips at 35 credits/7s clip) — deliberately scoped to just the 4
// clips the user picked (meera + ananya: reveal + button each), not the
// full remaining 13.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { execSync } from "child_process";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
let RUNWAY_API_KEY = "";
for (const line of envFile.split("\n")) {
  const m = line.match(/^RUNWAY_API_KEY=(.*)$/);
  if (m) RUNWAY_API_KEY = m[1].trim();
}
if (!RUNWAY_API_KEY) throw new Error("RUNWAY_API_KEY not found (active, uncommented) in .env.local");

const NEGATIVE_SUFFIX =
  " No text overlays, no on-screen captions, no invented product claims, no other products or logos beyond what's shown in the reference image.";

interface ClipSpec {
  persona: string;
  anchorFile: string;
  role: "reveal" | "button";
  label: string;
  prompt: string;
}

// Same grounded prompts as generatePersonaBatch.ts's CLIP_SPECS, scoped to
// just the 4 clips confirmed with the user: reveal + button (point) for
// meera and ananya only.
const CLIP_SPECS: ClipSpec[] = [
  {
    persona: "meera",
    anchorFile: "indian_elegant_kurta_living_room.jpg",
    role: "reveal",
    label: "reveal",
    prompt:
      "Static close-up shot. Her head turns slowly and continuously from one side toward the camera, hair moving naturally with the motion." +
      NEGATIVE_SUFFIX,
  },
  {
    persona: "meera",
    anchorFile: "indian_elegant_kurta_living_room.jpg",
    role: "button",
    label: "point",
    prompt:
      "Static close-up shot. She raises her hand and points her index finger directly toward the camera lens, a playful smile on her face." +
      NEGATIVE_SUFFIX,
  },
  {
    persona: "ananya",
    anchorFile: "southIndian_deeperskintone_smartcasual_homeoffice.jpg",
    role: "reveal",
    label: "reveal",
    prompt:
      "Static close-up shot. Her head turns slowly and continuously from one side toward the camera, hair moving naturally with the motion." +
      NEGATIVE_SUFFIX,
  },
  {
    persona: "ananya",
    anchorFile: "southIndian_deeperskintone_smartcasual_homeoffice.jpg",
    role: "button",
    label: "point",
    prompt:
      "Static close-up shot. She raises her hand and points her index finger directly toward the camera lens, a playful smile on her face." +
      NEGATIVE_SUFFIX,
  },
];

const OUT_DIR = path.join(__dirname, "..", "public", "persona-library");
mkdirSync(OUT_DIR, { recursive: true });

async function createTask(spec: ClipSpec): Promise<string> {
  const anchorPath = path.join(__dirname, "..", "storage", "mvp2", spec.anchorFile);
  const anchorDataUri = `data:image/jpeg;base64,${readFileSync(anchorPath).toString("base64")}`;

  const res = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNWAY_API_KEY}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify({
      model: "gen4_turbo",
      promptImage: anchorDataUri,
      promptText: spec.prompt,
      ratio: "720:1280",
      duration: 7,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create failed: ${res.status} ${text}`);
  const data = JSON.parse(text);
  if (!data.id) throw new Error(`create response missing id: ${text}`);
  return data.id;
}

async function pollTask(id: string): Promise<string> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, {
      headers: { Authorization: `Bearer ${RUNWAY_API_KEY}`, "X-Runway-Version": "2024-11-06" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`poll failed: ${res.status} ${text}`);
    const data = JSON.parse(text);
    console.log(`  poll ${id}: ${data.status}`);
    if (data.status === "SUCCEEDED") {
      if (!data.output?.[0]) throw new Error(`SUCCEEDED but no output: ${text}`);
      return data.output[0];
    }
    if (data.status === "FAILED" || data.status === "THROTTLED") {
      throw new Error(`task ${data.status}: ${text}`);
    }
  }
}

async function generateOne(spec: ClipSpec): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log(`starting: ${spec.persona}-${spec.label}`);
    const id = await createTask(spec);
    const outputUrl = await pollTask(id);
    const dl = await fetch(outputUrl);
    if (!dl.ok) throw new Error(`download failed: ${dl.status}`);
    const buffer = Buffer.from(await dl.arrayBuffer());
    const outPath = path.join(OUT_DIR, `${spec.persona}-${spec.label}.mp4`);
    writeFileSync(outPath, buffer);
    console.log(`  OK: ${spec.persona}-${spec.label}.mp4 (${buffer.length} bytes)`);
    return { ok: true };
  } catch (e: any) {
    console.error(`  FAILED: ${spec.persona}-${spec.label} — ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function main() {
  // First clip run alone to confirm the create/poll/download flow actually
  // works end-to-end against this never-before-exercised direct endpoint,
  // before committing the rest of the scarce 153-credit balance.
  const [first, ...rest] = CLIP_SPECS;
  const firstResult = await generateOne(first);
  const results: { persona: string; label: string; ok: boolean; error?: string }[] = [
    { persona: first.persona, label: first.label, ok: firstResult.ok, error: firstResult.error },
  ];

  if (firstResult.ok) {
    for (const spec of rest) {
      const r = await generateOne(spec);
      results.push({ persona: spec.persona, label: spec.label, ok: r.ok, error: r.error });
    }
  } else {
    console.error("\nFirst clip failed — stopping before spending on the rest. See error above.");
  }

  const succeeded = results.filter((r) => r.ok);
  console.log(`\n${succeeded.length}/${results.length} succeeded`);

  const durations: Record<string, number> = {};
  for (const r of succeeded) {
    const filePath = path.join(OUT_DIR, `${r.persona}-${r.label}.mp4`);
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    )
      .toString()
      .trim();
    durations[`${r.persona}-${r.label}`] = Math.round(parseFloat(out) * 30);
  }

  writeFileSync(
    path.join(__dirname, "personaBatchDirectResults.json"),
    JSON.stringify({ results, durations }, null, 2)
  );
  console.log("\nwritten: scripts/personaBatchDirectResults.json");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
