import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");

const characterPath = "D:\\temp\\codex-clipboard-bf9c929f-261e-40e1-8aef-71ab28787c12.png";
const referencePath = path.join(process.env.TEMP || "D:\\temp", "codex-runway-walk-ref.mp4");
const outDir = path.join(root, "out");
const statePath = path.join(__dirname, "actTwoWalkAttemptState.json");
mkdirSync(outDir, { recursive: true });

function readState() {
  if (!existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf-8"));
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const envFile = readFileSync(path.join(root, ".env.local"), "utf-8");
const candidates = envFile
  .split(/\r?\n/)
  .map((line, index) => {
    const m = line.match(/^#?RUNWAY_API_KEY=(.*)$/);
    return m ? { line: index + 1, commented: line.startsWith("#"), key: m[1].trim() } : null;
  })
  .filter(Boolean);

async function pickRunwayKey() {
  let best = null;
  for (const candidate of candidates) {
    const res = await fetch("https://api.dev.runwayml.com/v1/organization", {
      headers: { Authorization: `Bearer ${candidate.key}`, "X-Runway-Version": "2024-11-06" },
    });
    const text = await res.text();
    let creditBalance = -1;
    if (res.ok) creditBalance = Number(JSON.parse(text).creditBalance ?? -1);
    console.log(
      `Runway key candidate line ${candidate.line}${candidate.commented ? " (commented)" : ""}: ${res.status}, ${creditBalance} credits`
    );
    if (!best || creditBalance > best.creditBalance) best = { ...candidate, creditBalance };
  }
  if (!best || best.creditBalance <= 0) throw new Error("No Runway API key with available credits found");
  console.log(`Using Runway key from .env.local line ${best.line} (${best.creditBalance} credits)`);
  return best.key;
}

function dataUri(filePath, mime) {
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

async function createTask(key) {
  const state = readState();
  if (state.taskId && !state.downloaded) {
    console.log(`resuming task: ${state.taskId}`);
    return state.taskId;
  }

  const body = {
    model: "act_two",
    character: {
      type: "image",
      uri: dataUri(characterPath, "image/png"),
    },
    reference: {
      type: "video",
      uri: dataUri(referencePath, "video/mp4"),
    },
    bodyControl: true,
    expressionIntensity: 3,
    ratio: "720:1280",
    seed: 4105,
  };

  const res = await fetch("https://api.dev.runwayml.com/v1/character_performance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create failed: ${res.status} ${text}`);
  const data = JSON.parse(text);
  if (!data.id) throw new Error(`create response missing id: ${text}`);
  writeState({ taskId: data.id, createdAt: new Date().toISOString(), downloaded: false });
  return data.id;
}

async function pollTask(key, id) {
  let transientFailures = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 6000));
    let res;
    try {
      res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, {
        headers: { Authorization: `Bearer ${key}`, "X-Runway-Version": "2024-11-06" },
      });
    } catch (e) {
      transientFailures++;
      console.log(`poll transient fetch error (${transientFailures}/10), retrying`);
      if (transientFailures <= 10) continue;
      throw e;
    }
    transientFailures = 0;
    const text = await res.text();
    if (!res.ok) throw new Error(`poll failed: ${res.status} ${text}`);
    const data = JSON.parse(text);
    console.log(`poll: ${data.status}`);
    if (data.status === "SUCCEEDED" || data.status === "succeeded") {
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      if (!output) throw new Error(`SUCCEEDED but no output: ${text}`);
      return output;
    }
    if (["FAILED", "failed", "THROTTLED", "throttled", "CANCELLED", "cancelled"].includes(data.status)) {
      throw new Error(`task ${data.status}: ${text}`);
    }
  }
}

async function download(outputUrl) {
  const outPath = path.join(outDir, "act-two-walk-attempt.mp4");
  let res;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      res = await fetch(outputUrl);
      break;
    } catch (e) {
      console.log(`download transient fetch error (${attempt}/10), retrying`);
      if (attempt === 10) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buffer);
  const state = readState();
  writeState({ ...state, downloaded: true, file: outPath, bytes: buffer.length });
  console.log(`OK: ${outPath} (${buffer.length} bytes)`);
  return outPath;
}

async function main() {
  const key = await pickRunwayKey();
  const taskId = await createTask(key);
  const outputUrl = await pollTask(key, taskId);
  await download(outputUrl);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
