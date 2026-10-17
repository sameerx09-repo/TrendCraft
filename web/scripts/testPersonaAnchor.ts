// One real test clip against a NEW persona's anchor photo — verifying the
// pipeline before committing spend to a full 6-clip set. Real money
// (~$0.35), isolated: MOCK_MODE flipped in-process only, same pattern as
// scrapeNewReel.ts/buildComparisons.ts — .env.local itself is never touched.
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
process.env.MOCK_MODE = "false";

import { createVideoClip, getVideoClipStatus, downloadVideoClip } from "../lib/clients/runway";
import { buildBeatPrompt } from "../lib/render/runwayPromptTemplates";

async function main() {
  const anchorPath = path.join(
    __dirname,
    "..",
    "storage",
    "mvp2",
    "Indian_30s_kurta_livingroom_2.jpg"
  );
  const anchorBuffer = readFileSync(anchorPath);
  const anchorDataUri = `data:image/jpeg;base64,${anchorBuffer.toString("base64")}`;

  const prompt = buildBeatPrompt({ role: "setup", text: "test" });
  console.log("prompt:", prompt);

  console.log("submitting real Runway generation...");
  const created = await createVideoClip({
    prompt,
    firstFrameImageUrl: anchorDataUri,
    aspectRatio: "9:16",
    durationSeconds: 4,
  });
  console.log("created:", created.id, created.status);

  let status = created.status;
  let contentUrl: string | undefined;
  while (status === "pending" || status === "processing") {
    await new Promise((r) => setTimeout(r, 5000));
    const polled = await getVideoClipStatus(created.id);
    status = polled.status;
    contentUrl = polled.contentUrl;
    console.log("polling:", status);
  }
  if (status === "failed") throw new Error("generation failed");

  const buffer = await downloadVideoClip(created.id, contentUrl);
  const outPath = path.join(__dirname, "..", "scratch", "persona4-test-clip.mp4");
  writeFileSync(outPath, buffer);
  console.log("saved:", outPath, buffer.length, "bytes");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
