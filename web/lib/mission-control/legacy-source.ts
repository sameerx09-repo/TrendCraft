export function legacySource<
  T extends {
    script: { id: string; hookType?: string | null };
    trendItem: object | null;
  },
>(row: T) {
  const product = row.script.hookType === "product_edit";
  const brandRemix = row.script.hookType === "brand_feed_remix";
  const source = row.trendItem ?? {
    id:
      (product ? "product-" : brandRemix ? "brand-remix-" : "ugc-") +
      row.script.id,
    platform: product ? "local_upload" : brandRemix ? "brand_remix" : "ai_ugc",
    title: product ? "Product video" : brandRemix ? "Brand remix" : "AI UGC",
    caption: null,
    handle: null,
    viewCount: null,
    sourceUrl: "",
    sourceVideoUrl: null,
    thumbnailUrl: null,
  };
  return {
    ...row,
    trendItem:
      row.script.hookType === "ai_ugc"
        ? { ...source, platform: "ai_ugc" }
        : source,
  };
}
