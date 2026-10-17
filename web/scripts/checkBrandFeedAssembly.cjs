const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
function load(file, deps = {}) {
  const filename = path.resolve(file),
    loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const native = loaded.require.bind(loaded);
  loaded.require = (n) => (n in deps ? deps[n] : native(n));
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return loaded.exports;
}
(async () => {
  const data = await (
    await fetch("http://localhost:3001/api/brand-feed")
  ).json();
  const productCheck = process.argv.includes("--product");
  const original = data.feed.ideas.find((i) =>
    productCheck ? i.kind === "product" : i.kind !== "product",
  );
  if (!original)
    throw Error("No saved source available for an asset-only QA render.");
  const planner = load("lib/brand-feed/planner.ts"),
    storage = load("lib/storage/index.ts");
  const renderer = load("lib/render/renderRunwayMultiClip.ts");
  const postId = require("node:crypto").randomUUID(),
    idea = structuredClone(original);
  idea.job = { postId, state: "queued", updatedAt: new Date().toISOString() };
  const state = { ideas: [idea] };
  const render = load("lib/brand-feed/render.ts", {
    "server-only": {},
    "@/lib/storage": storage,
    "@/lib/db/client": {
      db: { update: () => ({ set: () => ({ where: async () => {} }) }) },
    },
    "@/lib/db/schema": { posts: { id: "id", brandProfileId: "brand" } },
    "drizzle-orm": { and: () => null, eq: () => null },
    "@/lib/db/ttlCache": { invalidateTtlCache: () => {} },
    "@/lib/render/poster": { savePosterFrame: async () => {} },
    "@/lib/brand-feed/planner": planner,
    "./planner": planner,
    "./store": { mutateFeed: async (id, f) => f(state) },
    "@/lib/render/renderRunwayMultiClip": renderer,
  });
  const frozen = await render.freezeScenes(idea, postId);
  console.log(
    "Rendering a local source-only QA video. No provider requests or database writes.",
  );
  await render.renderFeedIdea(
    "isolated-qa",
    data.brand.name,
    { ...idea, scenes: frozen },
    postId,
  );
  if (idea.job.state !== "complete")
    throw Error(idea.job.error || "Render did not complete");
  const target = path.resolve(
    "output/playwright/brand-feed-" +
      (productCheck ? "product-" : "") +
      "render-check.mp4",
  );
  fs.copyFileSync(
    path.resolve("storage/rendered-posts", path.basename(idea.job.url)),
    target,
  );
  console.log(
    JSON.stringify({
      target,
      bytes: fs.statSync(target).size,
      seconds: idea.scenes.reduce((n, s) => n + s.seconds, 0),
      providerCalls: 0,
      databaseWrites: 0,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
