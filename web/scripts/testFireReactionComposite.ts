import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";

/**
 * One-off render for the fire+reaction composite test — standalone bundle,
 * not sharing renderRunwayMultiClip.ts's cached bundle/port machinery since
 * this is a single manual test run, not a repeated server path.
 */
async function main() {
  const bundleLocation = await bundle({ entryPoint: path.join(process.cwd(), "remotion", "index.ts") });
  const composition = await selectComposition({ serveUrl: bundleLocation, id: "FireReactionComposite" });
  const outputPath = path.join(process.cwd(), "out", "fire-reaction-composite-test.mp4");
  await renderMedia({ composition, serveUrl: bundleLocation, codec: "h264", outputLocation: outputPath });
  console.log("Rendered:", outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
