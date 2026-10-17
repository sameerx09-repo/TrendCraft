const fs = require("fs"),
  path = require("path"),
  Module = require("module"),
  ts = require("typescript");
(async () => {
  const file = path.resolve("lib/render/renderRunwayMultiClip.ts");
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(compiled, file);
  const response = await fetch("http://localhost:3001/api/mission-control"),
    data = await response.json();
  const plan = data.campaigns.find(
    (c) => c.brief.name === "Night care launch",
  ).previewPlan;
  const concept = plan.concepts[0];
  const input = {
    brandName: data.brand.name,
    previewStyle: true,
    clips: concept.scenes.map((s) => ({
      type: s.type,
      ...(s.type === "video"
        ? { videoSrc: s.src.replace(/^\//, "") }
        : {
            imageSrc: s.src.startsWith("/storage/")
              ? new URL(s.src, "http://localhost:3001").href
              : s.src,
          }),
      durationInFrames: Math.round(s.seconds * 30),
      caption: s.caption,
      captionPosition: "bottom",
      captionSizeHint: "small",
      captionHasBackground: true,
      fit: "contain",
      muted: true,
      still: true,
    })),
  };
  console.log("Rendering an asset-only QA video. No provider calls.");
  const buffer = await loaded.exports.renderPersonaLibraryRemix(input);
  const target = path.resolve(
    "output/playwright/agent-preview-render-check.mp4",
  );
  fs.writeFileSync(target, buffer);
  console.log(JSON.stringify({ target, bytes: buffer.length, runwayCalls: 0 }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
