import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyFeed } from "./planner";
import type { FeedState } from "./types";
const root = path.join(process.cwd(), "storage", "brand-feeds");
const globalStore = globalThis as unknown as {
  brandFeedLocks?: Map<string, Promise<unknown>>;
};
const locks = (globalStore.brandFeedLocks ??= new Map());
export async function readFeed(id: string): Promise<FeedState> {
  try {
    return JSON.parse(await readFile(path.join(root, id + ".json"), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyFeed();
    throw e;
  }
}
export async function mutateFeed<T>(
  id: string,
  change: (feed: FeedState) => T | Promise<T>,
): Promise<T> {
  const previous = locks.get(id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const feed = await readFeed(id),
        result = await change(feed);
      await mkdir(root, { recursive: true });
      const target = path.join(root, id + ".json"),
        temp = path.join(root, id + "-" + crypto.randomUUID() + ".tmp");
      await writeFile(temp, JSON.stringify(feed), "utf8");
      await rename(temp, target);
      return result;
    });
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}
