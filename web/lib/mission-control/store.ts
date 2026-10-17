import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Campaign } from "./types";

const root = path.join(process.cwd(), "storage", "campaigns");
const globalStore = globalThis as unknown as {
  campaignLocks?: Map<string, Promise<unknown>>;
};
const locks = (globalStore.campaignLocks ??= new Map());

export async function readCampaigns(brandId: string): Promise<Campaign[]> {
  try {
    return JSON.parse(
      await readFile(path.join(root, brandId + ".json"), "utf8"),
    ) as Campaign[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// Serialize mutations within the local server and atomically replace the saved snapshot.
export async function mutateCampaigns<T>(
  brandId: string,
  mutate: (campaigns: Campaign[]) => T | Promise<T>,
): Promise<T> {
  const previous = locks.get(brandId) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const campaigns = await readCampaigns(brandId);
      const result = await mutate(campaigns);
      await mkdir(root, { recursive: true });
      const target = path.join(root, brandId + ".json");
      const temporary = path.join(
        root,
        brandId + "-" + crypto.randomUUID() + ".tmp",
      );
      await writeFile(temporary, JSON.stringify(campaigns), "utf8");
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
export function addActivity(campaign: Campaign, message: string, detail = "") {
  campaign.activity.unshift({
    id: crypto.randomUUID(),
    message,
    detail,
    createdAt: new Date().toISOString(),
  });
  campaign.activity = campaign.activity.slice(0, 100);
}
