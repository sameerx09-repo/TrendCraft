// One-off real scrape to pick a new reel for a fresh remix comparison.
// In-process MOCK_MODE override so .env.local's default (true) stays
// untouched for every other dev workflow. tsx doesn't auto-load .env.local
// the way Next.js does, so parse it manually here.
import { readFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}
process.env.MOCK_MODE = "false";

import { scrapeInstagramReels } from "../lib/clients/apify";

async function main() {
  const items = await scrapeInstagramReels(["ayurvedaskincare", "skincareindia"], 5);
  console.log(JSON.stringify(items, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
