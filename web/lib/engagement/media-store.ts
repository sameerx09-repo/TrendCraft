import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngagementMediaState } from "./media-types";
const root = path.join(process.cwd(), "storage", "engagement-media");
const globalStore = globalThis as unknown as {
  engagementMediaLocks?: Map<string, Promise<unknown>>;
};
const locks = (globalStore.engagementMediaLocks ??= new Map());
export async function readMediaState(
  brandId: string,
): Promise<EngagementMediaState> {
  try {
    return JSON.parse(
      await readFile(path.join(root, brandId + ".json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { uploads: [], publishedLinks: {} };
    throw e;
  }
}
export async function mutateMediaState<T>(
  brandId: string,
  change: (state: EngagementMediaState) => T | Promise<T>,
): Promise<T> {
  const previous = locks.get(brandId) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const state = await readMediaState(brandId),
        result = await change(state);
      await mkdir(root, { recursive: true });
      const target = path.join(root, brandId + ".json"),
        temporary = path.join(
          root,
          brandId + "-" + crypto.randomUUID() + ".tmp",
        );
      await writeFile(temporary, JSON.stringify(state), "utf8");
      await rename(temporary, target);
      return result;
    });
  locks.set(brandId, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(brandId) === operation) locks.delete(brandId);
  }
}
