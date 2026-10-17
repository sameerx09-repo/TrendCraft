import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");

const envFile = readFileSync(path.join(root, ".env.local"), "utf-8");
const RUNWAY_KEY_CANDIDATES = envFile
  .split(/\r?\n/)
  .map((line, index) => {
    const m = line.match(/^#?RUNWAY_API_KEY=(.*)$/);
    return m ? { line: index + 1, commented: line.startsWith("#"), key: m[1].trim() } : null;
  })
  .filter(Boolean);
if (RUNWAY_KEY_CANDIDATES.length === 0) throw new Error("RUNWAY_API_KEY not found in .env.local");

async function pickRunwayKey() {
  let best = null;
  for (const candidate of RUNWAY_KEY_CANDIDATES) {
    const res = await fetch("https://api.dev.runwayml.com/v1/organization", {
      headers: { Authorization: `Bearer ${candidate.key}`, "X-Runway-Version": "2024-11-06" },
    });
    const text = await res.text();
    let creditBalance = -1;
    if (res.ok) {
      creditBalance = Number(JSON.parse(text).creditBalance ?? -1);
    }
    console.log(
      `Runway key candidate line ${candidate.line}${candidate.commented ? " (commented)" : ""}: ${res.status}, ${creditBalance} credits`
    );
    if (!best || creditBalance > best.creditBalance) best = { ...candidate, creditBalance };
  }
  if (!best || best.creditBalance <= 0) throw new Error("No Runway API key with available credits found");
  console.log(`Using Runway key from .env.local line ${best.line} (${best.creditBalance} credits)`);
  return best.key;
}

const OUT_DIR = path.join(root, "public", "persona-library");
mkdirSync(OUT_DIR, { recursive: true });
const statePath = path.join(__dirname, "ananyaGen45TaskState.json");
function readState() {
  if (!existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf-8"));
}
function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const anchorPath = path.join(OUT_DIR, "ananya-anchor.jpg");
const anchorDataUri = `data:image/jpeg;base64,${readFileSync(anchorPath).toString("base64")}`;

const negative =
  " Keep her identity, face, outfit, lighting, and framing consistent with the reference image. No text overlays, no captions, no subtitles, no logos, no products, no jars, no packaging, no extra people, no malformed hands.";

const specs = [
  {
    label: "hook",
    prompt:
      "Static vertical smartphone-style close-up. She looks directly into the camera with calm confident eye contact, natural slow breathing, then gives a tiny curious smile as if opening a UGC ad hook." +
      negative,
  },
  {
    label: "reveal",
    prompt:
      "Static vertical smartphone-style close-up. She glances slightly off-camera to her right, then turns back toward the camera with a pleased 'this is actually good' expression and a soft natural smile." +
      negative,
  },
  {
    label: "cta",
    prompt:
      "Static vertical smartphone-style close-up. She raises one hand and points gently toward the lower-right side of the frame, then nods once with a confident friendly smile, leaving empty space for an app-rendered product card." +
      negative,
  },
];

const DURATION_SECONDS = 4;

async function createTask(spec) {
  const RUNWAY_API_KEY = await runwayKeyPromise;
  const state = readState();
  if (state[spec.label]?.taskId && !state[spec.label]?.downloaded) {
    console.log(`  resuming task ${spec.label}: ${state[spec.label].taskId}`);
    return state[spec.label].taskId;
  }
  const res = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNWAY_API_KEY}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify({
      model: "gen4.5",
      promptImage: anchorDataUri,
      promptText: spec.prompt,
      ratio: "720:1280",
      duration: DURATION_SECONDS,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create ${spec.label} failed: ${res.status} ${text}`);
  const data = JSON.parse(text);
  if (!data.id) throw new Error(`create ${spec.label} response missing id: ${text}`);
  state[spec.label] = { taskId: data.id, createdAt: new Date().toISOString(), downloaded: false };
  writeState(state);
  return data.id;
}

async function pollTask(id, label) {
  const RUNWAY_API_KEY = await runwayKeyPromise;
  let transientFailures = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 6000));
    let res;
    try {
      res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, {
        headers: { Authorization: `Bearer ${RUNWAY_API_KEY}`, "X-Runway-Version": "2024-11-06" },
      });
    } catch (e) {
      transientFailures++;
      console.log(`  poll ${label}: transient fetch error (${transientFailures}/10), retrying`);
      if (transientFailures <= 10) continue;
      throw e;
    }
    transientFailures = 0;
    const text = await res.text();
    if (!res.ok) throw new Error(`poll ${label} failed: ${res.status} ${text}`);
    const data = JSON.parse(text);
    console.log(`  poll ${label}: ${data.status}`);
    if (data.status === "SUCCEEDED" || data.status === "succeeded") {
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      if (!output) throw new Error(`task ${label} succeeded but no output: ${text}`);
      return output;
    }
    if (["FAILED", "failed", "THROTTLED", "throttled", "CANCELLED", "cancelled"].includes(data.status)) {
      throw new Error(`task ${label} ${data.status}: ${text}`);
    }
  }
}

async function generateOne(spec) {
  console.log(`starting: ananya-gen45-${spec.label}`);
  const outPath = path.join(OUT_DIR, `ananya-2026-10-04-gen45-${spec.label}.mp4`);
  if (existsSync(outPath)) {
    console.log(`  SKIP: ${path.basename(outPath)} already exists`);
    return outPath;
  }
  const id = await createTask(spec);
  const outputUrl = await pollTask(id, spec.label);
  let dl;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      dl = await fetch(outputUrl);
      break;
    } catch (e) {
      console.log(`  download ${spec.label}: transient fetch error (${attempt}/10), retrying`);
      if (attempt === 10) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!dl.ok) throw new Error(`download ${spec.label} failed: ${dl.status}`);
  const buffer = Buffer.from(await dl.arrayBuffer());
  writeFileSync(outPath, buffer);
  const state = readState();
  state[spec.label] = { ...(state[spec.label] ?? {}), downloaded: true, file: outPath };
  writeState(state);
  console.log(`  OK: ${path.basename(outPath)} (${buffer.length} bytes)`);
  return outPath;
}

async function main() {
  const results = [];
  const durations = {};

  for (const spec of specs) {
    try {
      const outPath = await generateOne(spec);
      results.push({ label: spec.label, ok: true, file: outPath });
      try {
        const out = execFileSync("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          outPath,
        ])
          .toString()
          .trim();
        durations[`ananya-2026-10-04-gen45-${spec.label}`] = Math.round(parseFloat(out) * 30);
      } catch (e) {
        durations[`ananya-2026-10-04-gen45-${spec.label}`] = null;
      }
    } catch (e) {
      const details =
        e instanceof Error
          ? `${e.message}${e.cause ? ` | cause: ${JSON.stringify(e.cause)}` : ""}\n${e.stack ?? ""}`
          : String(e);
      results.push({ label: spec.label, ok: false, error: details });
      console.error(`  FAILED: ${spec.label} - ${details}`);
      break;
    }
  }

  const resultPath = path.join(__dirname, "ananyaGen45Results.json");
  writeFileSync(resultPath, JSON.stringify({ results, durations }, null, 2));
  console.log(`written: ${resultPath}`);

  const failed = results.find((r) => !r.ok);
  if (failed) process.exit(1);
}

const runwayKeyPromise = pickRunwayKey();

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
