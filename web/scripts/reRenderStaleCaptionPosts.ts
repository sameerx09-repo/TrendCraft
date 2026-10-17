// Re-renders every persona-library post whose video predates the caption
// position/size fix (Remotion bundle restart on 2026-09-25 ~07:00Z) — same
// persona/clip content either way (seeded by postId, deterministic), only
// the caption's position/size/font actually changes. $0 cost, concurrency 2
// to match the resource-contention finding from the auto-render work.
import { readFileSync } from "fs";
import path from "path";

const envFile = readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const CONCURRENCY = 2;
const CUTOFF = "2026-09-25T07:00:00Z";

async function main() {
  const { db } = await import("../lib/db/client");
  const { posts } = await import("../lib/db/schema");
  const { and, eq, isNotNull, lt } = await import("drizzle-orm");

  const stale = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(isNotNull(posts.renderedFileUrl), lt(posts.renderedAt, new Date(CUTOFF)), eq(posts.format, "runway_remix")));

  console.log(`${stale.length} stale posts to re-render, concurrency ${CONCURRENCY}...`);

  const queue = [...stale];
  let done = 0;
  let failed = 0;
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      try {
        await db.update(posts).set({ renderedFileUrl: null, renderedAt: null }).where(eq(posts.id, item.id));
        const res = await fetch(`http://localhost:4400/api/posts/${item.id}/generate-persona`, { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        done++;
      } catch (e) {
        failed++;
        console.error(`  failed ${item.id}:`, e instanceof Error ? e.message : e);
      }
      console.log(`  ${done + failed}/${stale.length} (${failed} failed)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done: ${done} re-rendered, ${failed} failed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
