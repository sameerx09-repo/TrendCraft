import { readFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
process.env.MOCK_MODE = "true";

async function main() {
  // Dynamic import so this runs AFTER the env vars above are set — a static
  // top-level import gets hoisted by tsx/esbuild ahead of this file's own
  // statements, which made lib/db/client.ts read DATABASE_URL before it existed.
  const { db } = await import("../lib/db/client");
  const { posts } = await import("../lib/db/schema");
  const all = await db.select().from(posts);
  for (const p of all) {
    console.log(p.id, "| status:", p.status, "| format:", p.format, "| rendered:", !!p.renderedFileUrl, "| url:", p.renderedFileUrl);
  }
  console.log(`\ntotal: ${all.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
