import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  helloWorld,
  scrapeTrendsForBrand,
  discoverPopularTrendsForBrand,
  syncProductCatalogForBrand,
  generateProductCopyForBrand,
  remixSkeletonMatchedItems,
  scrapeYoutubeTrendingForBrand,
  renderSlideshowForPost,
  generateRunwayRemixForPost,
  generatePersonaLibraryRemixForPost,
  generateArtifactRemixForPost,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    helloWorld,
    scrapeTrendsForBrand,
    discoverPopularTrendsForBrand,
    syncProductCatalogForBrand,
    generateProductCopyForBrand,
    remixSkeletonMatchedItems,
      scrapeYoutubeTrendingForBrand,
    renderSlideshowForPost,
    generateRunwayRemixForPost,
    generatePersonaLibraryRemixForPost,
    generateArtifactRemixForPost,
  ],
});
