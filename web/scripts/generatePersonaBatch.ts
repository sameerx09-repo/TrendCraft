// Real batch generation — 4 new personas × 6 clips each = 24 real Runway
// generations (~$0.35/clip at the proven 7s/gen4_turbo spec, ~$8-9 total).
// Reuses the exact 6 grounded prompts that produced Priya's real clip set
// (personaLibraryPrompts.md), not improvised new ones, and the same
// NEGATIVE_SUFFIX convention as runwayPromptTemplates.ts.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { execSync } from "child_process";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
process.env.MOCK_MODE = "false";

import { createVideoClip, getVideoClipStatus, downloadVideoClip } from "../lib/clients/runway";

const NEGATIVE_SUFFIX =
  " No text overlays, no on-screen captions, no invented product claims, no other products or logos beyond what's shown in the reference image.";

interface ClipSpec {
  role: "setup" | "reveal" | "button";
  label: string;
  prompt: string;
}

// The exact 6 grounded prompts from personaLibraryPrompts.md that produced
// Priya's real clips — same text, new anchor per persona.
const CLIP_SPECS: ClipSpec[] = [
  {
    role: "setup",
    label: "hook",
    prompt:
      "Static close-up shot. She holds steady eye contact with the camera, a calm and relaxed expression, natural slow breathing motion." +
      NEGATIVE_SUFFIX,
  },
  {
    role: "setup",
    label: "deadpan",
    prompt:
      "Static close-up shot. She holds a flat, deadpan expression, one eyebrow raised slightly, looking directly at the camera without smiling." +
      NEGATIVE_SUFFIX,
  },
  {
    role: "reveal",
    label: "reveal",
    prompt:
      "Static close-up shot. Her head turns slowly and continuously from one side toward the camera, hair moving naturally with the motion." +
      NEGATIVE_SUFFIX,
  },
  {
    role: "reveal",
    label: "smirk",
    prompt:
      "Static close-up shot. A playful smirk grows on her face as she tilts her head to one side, eyes staying on the camera." + NEGATIVE_SUFFIX,
  },
  {
    role: "button",
    label: "point",
    prompt:
      "Static close-up shot. She raises her hand and points her index finger directly toward the camera lens, a playful smile on her face." +
      NEGATIVE_SUFFIX,
  },
  {
    role: "button",
    label: "hairtuck",
    prompt:
      "Static close-up shot. Her hand tucks a strand of hair behind her ear in one smooth continuous motion, then she glances toward the camera." +
      NEGATIVE_SUFFIX,
  },
];

interface Persona {
  id: string;
  anchorFile: string;
}

const PERSONAS: Persona[] = [
  { id: "meera", anchorFile: "indian_elegant_kurta_living_room.jpg" },
  { id: "ananya", anchorFile: "southIndian_deeperskintone_smartcasual_homeoffice.jpg" },
  { id: "diya", anchorFile: "Indian_20s_playful_trendywear_outdoors.jpg" },
  { id: "kavya", anchorFile: "Indian_30s_kurta_livingroom_2.jpg" },
];

const OUT_DIR = path.join(__dirname, "..", "public", "persona-library");
mkdirSync(OUT_DIR, { recursive: true });

async function generateOne(persona: Persona, spec: ClipSpec): Promise<{ persona: string; label: string; ok: boolean; error?: string }> {
  const anchorPath = path.join(__dirname, "..", "storage", "mvp2", persona.anchorFile);
  const anchorDataUri = `data:image/jpeg;base64,${readFileSync(anchorPath).toString("base64")}`;

  try {
    const created = await createVideoClip({
      prompt: spec.prompt,
      firstFrameImageUrl: anchorDataUri,
      aspectRatio: "9:16",
      durationSeconds: 7,
    });

    let status = created.status;
    let contentUrl: string | undefined;
    while (status === "pending" || status === "processing") {
      await new Promise((r) => setTimeout(r, 5000));
      const polled = await getVideoClipStatus(created.id);
      status = polled.status;
      contentUrl = polled.contentUrl;
    }
    if (status === "failed") throw new Error("generation failed");

    const buffer = await downloadVideoClip(created.id, contentUrl);
    const outPath = path.join(OUT_DIR, `${persona.id}-${spec.label}.mp4`);
    writeFileSync(outPath, buffer);
    console.log(`  OK: ${persona.id}-${spec.label}.mp4 (${buffer.length} bytes)`);
    return { persona: persona.id, label: spec.label, ok: true };
  } catch (e: any) {
    console.error(`  FAILED: ${persona.id}-${spec.label} — ${e.message}`);
    return { persona: persona.id, label: spec.label, ok: false, error: e.message };
  }
}

async function main() {
  const results: { persona: string; label: string; ok: boolean; error?: string; role: string }[] = [];

  // Concurrency: one clip in flight per persona at a time (4 concurrent
  // overall), moving each persona through its own 6 clips sequentially —
  // real parallelism across personas without hammering the API with 24
  // simultaneous requests.
  await Promise.all(
    PERSONAS.map(async (persona) => {
      for (const spec of CLIP_SPECS) {
        console.log(`starting: ${persona.id}-${spec.label}`);
        const result = await generateOne(persona, spec);
        results.push({ ...result, role: spec.role });
      }
    })
  );

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${succeeded.length}/${results.length} succeeded`);
  if (failed.length) {
    console.log("failed:", failed.map((f) => `${f.persona}-${f.label}`).join(", "));
  }

  // Real ffprobe-measured durations for each successful clip — matching
  // personaLibrary.ts's own stated policy of never assuming duration.
  const durations: Record<string, number> = {};
  for (const r of succeeded) {
    const filePath = path.join(OUT_DIR, `${r.persona}-${r.label}.mp4`);
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    )
      .toString()
      .trim();
    const seconds = parseFloat(out);
    durations[`${r.persona}-${r.label}`] = Math.round(seconds * 30); // frames @ 30fps
  }

  writeFileSync(
    path.join(__dirname, "personaBatchResults.json"),
    JSON.stringify({ results, durations }, null, 2)
  );
  console.log("\nwritten: scripts/personaBatchResults.json");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
