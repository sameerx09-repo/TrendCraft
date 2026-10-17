// REAL SPEND — small calibration batch.
//
// Caption clustering failed because captions are metadata (hashtag soup), not
// performance. The rhetorical skeleton lives in what the creator SAYS. This
// pulls real transcripts so we can cluster the right text field.
//
// Transcript is an add-on billed PER MINUTE OF AUDIO and the rate is not
// exposed via the API, so this runs a deliberately small batch and reports the
// run's actual usageTotalUsd. Scale only after seeing that number.
//
// Input schema verified against the live build schema (username[] accepts
// direct reel URLs; includeTranscript is opt-in) before spending.
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error("APIFY_TOKEN missing");

const BATCH = 12;
const ACTOR = "apify~instagram-reel-scraper";

interface Raw { [k: string]: unknown }
const plays = (r: Raw) =>
  (r.videoPlayCount as number) ?? (r.igPlayCount as number) ?? (r.videoViewCount as number) ?? 0;
const dur = (r: Raw) => (r.videoDuration as number) ?? (r.duration as number) ?? 0;

async function main() {
  const raw: Raw[] = JSON.parse(
    readFileSync(path.join(process.cwd(), "scratch", "popular-reels-raw.json"), "utf-8")
  );

  // advice + storytime only. motivation proved to be gym/study/devotional
  // spectacle — visually entangled and useless to us whatever it says.
  const pool = raw
    .filter((r) => !r.error)
    .filter((r) => {
      const kw = String(r.inputUrl ?? "").replace(/\/$/, "").split("/").pop();
      return kw === "advice" || kw === "storytime";
    })
    // needs enough speech to carry a skeleton, but not a 3-minute monologue
    .filter((r) => dur(r) >= 10 && dur(r) <= 90)
    .sort((a, b) => plays(b) - plays(a));

  const picked = pool.slice(0, BATCH);
  console.log(`Pool: ${pool.length} eligible -> requesting ${picked.length}\n`);
  picked.forEach((r) =>
    console.log(`  ${plays(r).toLocaleString().padStart(12)} | ${String(dur(r)).padStart(3)}s | @${r.ownerUsername}`)
  );

  const start = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: picked.map((r) => r.url),
      resultsLimit: 1,
      includeTranscript: true,
    }),
  });
  if (!start.ok) throw new Error(`start ${start.status}: ${(await start.text()).slice(0, 400)}`);
  const runId = (await start.json()).data.id;
  console.log(`\nrun ${runId} — polling...`);

  let run: Record<string, unknown> = {};
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    run = (await (await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${TOKEN}`)).json()).data;
    process.stdout.write(`\r  ${run.status} (${(i + 1) * 5}s)   `);
    if (run.status !== "RUNNING" && run.status !== "READY") break;
  }
  console.log(`\nfinished: ${run.status}`);
  console.log(`COST: $${run.usageTotalUsd ?? "?"}\n`);

  const items: Raw[] = await (
    await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${TOKEN}`)
  ).json();
  writeFileSync(path.join(process.cwd(), "scratch", "transcripts-raw.json"), JSON.stringify(items, null, 2));
  console.log(`${items.length} items -> scratch/transcripts-raw.json\n`);

  const withT = items.filter((r) => r.transcript);
  console.log(`Transcript present: ${withT.length}/${items.length}\n`);
  console.log("=".repeat(72));
  for (const r of items) {
    const t = String(r.transcript ?? "");
    console.log(`@${r.ownerUsername} | ${plays(r).toLocaleString()} plays | ${dur(r)}s`);
    console.log(t ? `  "${t.replace(/\s+/g, " ").slice(0, 400)}"` : "  (no transcript)");
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
