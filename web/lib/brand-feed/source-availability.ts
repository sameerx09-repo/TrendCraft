import "server-only";
import { stat } from "node:fs/promises";
import path from "node:path";
import { isLocalMedia } from "./planner";
import type { ReelSource } from "./types";

export async function availableSources(
  sources: ReelSource[],
): Promise<ReelSource[]> {
  const checked = await Promise.all(
    sources.map(async (source) => {
      const media = await Promise.all(
        source.media.map(async (asset) => {
          if (!isLocalMedia(asset.src)) return null;
          try {
            const file = await stat(
              path.join(process.cwd(), asset.src.slice(1)),
            );
            return file.isFile() && file.size > 0 ? asset : null;
          } catch {
            return null;
          }
        }),
      );
      const usable = media.filter(
        (asset): asset is ReelSource["media"][number] => asset !== null,
      );
      return usable.length ? { ...source, media: usable } : null;
    }),
  );
  return checked.filter((source): source is ReelSource => source !== null);
}
