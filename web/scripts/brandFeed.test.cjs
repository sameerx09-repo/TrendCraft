const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (n) => (n in deps ? deps[n] : require(n)),
    crypto: crypto.webcrypto,
    structuredClone,
    Request,
    Response,
    FormData,
    Blob,
    File: require("node:buffer").File,
    URL,
    Buffer,
    console,
    AbortSignal,
    setTimeout,
    process: deps.__process || process,
  });
  return exports;
}
const planner = load("lib/brand-feed/planner.ts");
const product = {
  id: "product",
  title: "Night Cream",
  imageUrl: "https://brand.example/cream.jpg",
  description: "Night cream",
  productType: "Skincare",
};
const source = (id, kind = "viral", ready = true) => ({
  id,
  kind,
  title: "Bestie",
  caption: "How my bestie came into my life",
  sourceUrl: "https://example.com/reel",
  thumbnailUrl: null,
  ready,
  media: [
    {
      id: "asset",
      src: "/storage/viral-trend-artifacts/asset.gif",
      type: "gif",
    },
  ],
});
function setup() {
  const state = planner.emptyFeed();
  const sources = [
    source("viral"),
    source("trend", "trend"),
    source("unready", "trend", false),
  ];
  const data = {
    brand: { name: "Brand", identity: "Skincare", toneOfVoice: "Warm" },
    products: [product],
    sources,
    feed: state,
    mockMode: true,
  };
  state.ideas = planner.buildIdeas({
    brandName: "Brand",
    products: [product],
    sources,
    state,
    now: "2026-10-16",
  });
  return data;
}
test("balanced batch uses actual trend, viral and product sources", () => {
  const d = setup();
  assert.deepEqual(
    [...d.feed.ideas.map((i) => i.kind)],
    ["trend", "viral", "product"],
  );
  assert.ok(!d.feed.ideas.some((i) => i.source?.id === "unready"));
});
test("message-led drafts contain sourced media, no product or persona insert", () => {
  for (const i of setup().feed.ideas.filter((i) => i.kind !== "product")) {
    assert.equal(i.scenes.length, 1);
    assert.equal(i.scenes[0].src, "/storage/viral-trend-artifacts/asset.gif");
    assert.ok(!JSON.stringify(i.scenes).includes("persona"));
    assert.ok(!JSON.stringify(i.scenes).includes(product.imageUrl));
  }
});
test("product draft uses brand packaging, not the reference's product", () => {
  const d = setup();
  d.sources.push(source("sample", "product"));
  const ideas = planner.buildIdeas({
    brandName: "Brand",
    products: [product],
    sources: d.sources,
    state: d.feed,
  });
  const p = ideas.find((i) => i.kind === "product");
  assert.equal(p.source.id, "sample");
  assert.ok(p.scenes.every((s) => s.src === product.imageUrl));
});
test("no reference means product draft is honestly an image storyboard", () => {
  const p = setup().feed.ideas.find((i) => i.kind === "product");
  assert.equal(p.source, null);
  assert.match(p.adaptation, /storyboard/);
});
test("initial draft IDs are stable and batches have distinct IDs", () => {
  const d = setup(),
    input = {
      brandName: "Brand",
      products: d.products,
      sources: d.sources,
      state: d.feed,
    };
  const a = planner.buildIdeas(input),
    b = planner.buildIdeas(input);
  assert.deepEqual([...a.map((i) => i.id)], [...b.map((i) => i.id)]);
  d.feed.batch++;
  const c = planner.buildIdeas(input);
  assert.notEqual(a[0].id, c[0].id);
});
test("message-led-only direction excludes product shots", () => {
  const d = setup();
  d.feed.context.direction = "Message-led only. No product shots.";
  const ideas = planner.buildIdeas({
    brandName: "Brand",
    products: d.products,
    sources: d.sources,
    state: d.feed,
  });
  assert.ok(ideas.length);
  assert.ok(ideas.every((i) => i.kind !== "product"));
});
test("product-led-only direction excludes message remixes", () => {
  const d = setup();
  d.feed.context.direction = "Product-led only";
  const ideas = planner.buildIdeas({
    brandName: "Brand",
    products: d.products,
    sources: d.sources,
    state: d.feed,
  });
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].kind, "product");
});
test("copy does not invent product effects or testimonials", () => {
  const copy = setup()
    .feed.ideas.flatMap((i) => i.scenes.map((s) => s.caption))
    .join(" ");
  assert.doesNotMatch(
    copy,
    /cure|repair|glowing|clinically|results|actually works|I used/i,
  );
});
test("Hinglish changes draft copy", () => {
  const d = setup();
  d.feed.context.language = "hinglish";
  const ideas = planner.buildIdeas({
    brandName: "Brand",
    products: d.products,
    sources: d.sources,
    state: d.feed,
  });
  assert.match(ideas[0].scenes[0].caption, /Jab|Main/);
});
test("missing product catalog still permits message remixes", () => {
  const d = setup();
  const ideas = planner.buildIdeas({
    brandName: "Brand",
    products: [],
    sources: d.sources,
    state: d.feed,
  });
  assert.equal(ideas.length, 2);
  assert.ok(ideas.every((i) => i.kind !== "product"));
});
test("missing ready references does not fabricate trend or viral reels", () => {
  const d = setup();
  const ideas = planner.buildIdeas({
    brandName: "Brand",
    products: d.products,
    sources: [],
    state: d.feed,
  });
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].kind, "product");
});
test("local media validation rejects remote sources and traversal", () => {
  assert.ok(planner.isLocalMedia("/storage/viral-trend-artifacts/id.gif"));
  assert.ok(planner.isLocalMedia("/storage/source-videos/id.mp4"));
  for (const s of [
    "https://example.com/a.mp4",
    "/storage/source-videos/../a.mp4",
    "/storage/viral-trend-artifacts/a.html",
    "//evil/a.mp4",
  ])
    assert.equal(planner.isLocalMedia(s), false);
});
test("editing increments revision and rejects stale versions", () => {
  const i = setup().feed.ideas[0];
  planner.editIdea(i, 1, ["My new message."]);
  assert.equal(i.revision, 2);
  assert.equal(i.scenes[0].caption, "My new message.");
  assert.throws(() => planner.editIdea(i, 1, ["Again"]), /changed/);
});
test("editing rejects blank, oversized or missing captions", () => {
  const i = setup().feed.ideas[0];
  for (const x of [[], [""], ["a".repeat(201)], ["x", "y"]])
    assert.throws(() => planner.editIdea(i, 1, x), /message/);
});
test("production locks the approved version", () => {
  const i = setup().feed.ideas[0];
  i.job = { postId: "post", state: "queued" };
  assert.throws(() => planner.editIdea(i, 1, ["Changed"]), /production/);
});
function harness() {
  const data = setup(),
    persisted = planner.emptyFeed(),
    events = [],
    inserted = [],
    frozen = [];
  let queue = Promise.resolve();
  const chain = {
    values(v) {
      inserted.push(v);
      return { returning: async () => [{ id: "script" }] };
    },
  };
  const api = load("app/api/brand-feed/route.ts", {
    "next/server": {
      after: (f) => events.push(f),
      NextResponse: { json: (v, o) => Response.json(v, o) },
    },
    "@/lib/db/client": {
      db: { transaction: async (f) => f({ insert: () => chain }) },
    },
    "@/lib/db/schema": { posts: {}, remixedScripts: {} },
    "@/lib/db/getOrCreateBrand": {
      getOrCreateCurrentBrand: async () => ({
        id: "brand",
        name: "Brand",
        identity: "Skincare",
      }),
    },
    "@/lib/brand-feed/data": {
      getFeedData: async () => ({
        ...data,
        feed: persisted.ideas.length ? persisted : data.feed,
      }),
    },
    "@/lib/brand-feed/store": {
      mutateFeed: async (id, f) => {
        const next = queue.then(() => f(persisted));
        queue = next.catch(() => {});
        return next;
      },
    },
    "@/lib/brand-feed/planner": planner,
    "@/lib/brand-feed/render": {
      freezeScenes: async (i, id) => {
        frozen.push(structuredClone(i));
        return i.scenes;
      },
      renderFeedIdea: async () => {},
    },
    "@/lib/db/ttlCache": { invalidateTtlCache: () => {} },
  });
  async function post(body) {
    const r = await api.POST(
      new Request("http://localhost/api/brand-feed", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    );
    return { status: r.status, data: await r.json() };
  }
  return {
    api,
    post,
    data,
    persisted,
    events,
    inserted,
    frozen,
    id: data.feed.ideas[0].id,
  };
}
test("GET only returns drafts, never queues production", async () => {
  const h = harness();
  const r = await h.api.GET();
  assert.equal(r.status, 200);
  assert.equal(h.events.length, 0);
  assert.equal(h.inserted.length, 0);
});
test("keep persists a draft without approval or production", async () => {
  const h = harness();
  const r = await h.post({
    action: "decision",
    ideaId: h.id,
    decision: "kept",
  });
  assert.equal(r.status, 200);
  assert.equal(h.persisted.ideas[0].decision, "kept");
  assert.equal(h.events.length, 0);
  assert.equal(h.inserted.length, 0);
});
test("assembly requires approval, current revision, and kept idea", async () => {
  const h = harness();
  for (const body of [
    { reviewed: false, revision: 1 },
    { reviewed: true, revision: 0 },
    { reviewed: true, revision: 1 },
  ])
    assert.equal(
      (await h.post({ action: "assemble", ideaId: h.id, ...body })).status,
      400,
    );
  assert.equal(h.events.length, 0);
  assert.equal(h.inserted.length, 0);
});
test("approved assembly uses stored scenes, not client replacement media", async () => {
  const h = harness();
  await h.post({ action: "decision", ideaId: h.id, decision: "kept" });
  const r = await h.post({
    action: "assemble",
    ideaId: h.id,
    reviewed: true,
    revision: 1,
    scenes: [{ src: "https://evil.example" }],
  });
  assert.equal(r.status, 202);
  assert.equal(h.events.length, 1);
  assert.equal(h.inserted.length, 2);
  assert.equal(
    h.frozen[0].scenes[0].src,
    "/storage/viral-trend-artifacts/asset.gif",
  );
  assert.equal(h.inserted[0].personaId, null);
  assert.equal(h.inserted[0].hookType, "brand_feed_remix");
});
test("duplicate assembly requests reuse the existing job", async () => {
  const h = harness();
  await h.post({ action: "decision", ideaId: h.id, decision: "kept" });
  const body = {
    action: "assemble",
    ideaId: h.id,
    reviewed: true,
    revision: 1,
  };
  const [a, b] = await Promise.all([h.post(body), h.post(body)]);
  assert.equal(a.data.postId, b.data.postId);
  assert.equal(h.events.length, 1);
  assert.equal(h.inserted.length, 2);
});
test("batch preserves kept and production ideas", async () => {
  const h = harness();
  await h.post({ action: "decision", ideaId: h.id, decision: "kept" });
  const r = await h.post({ action: "batch" });
  assert.equal(r.status, 200);
  assert.ok(
    h.persisted.ideas.some((i) => i.id === h.id && i.decision === "kept"),
  );
  assert.equal(h.events.length, 0);
});
test("unknown catalog product and source IDs are rejected", async () => {
  const h = harness();
  assert.equal(
    (await h.post({ action: "context", context: { productId: "foreign" } }))
      .status,
    400,
  );
  assert.equal(
    (
      await h.post({
        action: "source-kind",
        sourceId: "foreign",
        kind: "product",
      })
    ).status,
    400,
  );
});
test("upload requires explicit media rights and allowed type", async () => {
  let writes = 0;
  const api = load("app/api/brand-feed/samples/route.ts", {
    "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
    "@/lib/db/getOrCreateBrand": {
      getOrCreateCurrentBrand: async () => ({ id: "brand" }),
    },
    "@/lib/storage": {
      put: async () => {
        writes++;
        return "/storage/viral-trend-artifacts/a.gif";
      },
    },
    "@/lib/brand-feed/store": {
      mutateFeed: async (id, f) => f(planner.emptyFeed()),
    },
    "@/lib/brand-feed/planner": planner,
  });
  const make = (rights) => {
    const form = new FormData();
    form.set("title", "Reference");
    form.set("kind", "product");
    form.set("file", new Blob(["GIF89a"], { type: "image/gif" }), "a.gif");
    if (rights) form.set("rights", "true");
    return new Request("http://localhost/api/brand-feed/samples", {
      method: "POST",
      body: form,
    });
  };
  const denied = await api.POST(make(false));
  assert.equal(denied.status, 400);
  assert.equal(writes, 0);
  const accepted = await api.POST(make(true));
  assert.equal(accepted.status, 201);
  assert.equal(writes, 1);
  const payload = await accepted.json();
  assert.equal(payload.sample.kind, "product");
});

test("gallery metadata never labels product or source-less brand edits as persona UGC", () => {
  const { legacySource } = load("lib/mission-control/legacy-source.ts");
  assert.equal(
    legacySource({
      script: { id: "s", hookType: "product_edit" },
      trendItem: null,
    }).trendItem.platform,
    "local_upload",
  );
  assert.equal(
    legacySource({
      script: { id: "s", hookType: "brand_feed_remix" },
      trendItem: null,
    }).trendItem.platform,
    "brand_remix",
  );
});
test("legacy renderers cannot replace asset-only previews with personas or paid footage", async () => {
  const files = [
    "generate-persona",
    "generate-artifact-remix",
    "generate-runway",
  ];
  for (const name of files) {
    let reads = 0;
    const dependencies = {
      "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
      "@/lib/db/client": {
        db: {
          select: () => ({
            from: () => ({
              where: async () =>
                ++reads === 1
                  ? [
                      {
                        id: "post",
                        remixedScriptId: "script",
                        renderedFileUrl: null,
                      },
                    ]
                  : [{ id: "script", hookType: "brand_feed_remix" }],
            }),
          }),
        },
      },
      "@/lib/db/schema": { posts: { id: "id" }, remixedScripts: { id: "id" } },
      "drizzle-orm": { eq: () => null },
      "@/lib/render/personaLibrary": {},
      "@/lib/render/runwayPromptTemplates": {},
      "@/lib/render/renderRunwayMultiClip": {},
      "@/lib/clients/captionStyleAnalyzer": {},
      "@/lib/render/poster": {},
      "@/lib/storage": {},
      "@/lib/render/artifactMedia": {},
      "@/lib/render/skeletonLibrary": {},
      "@/lib/clients/runway": {},
    };
    const api = load("app/api/posts/[id]/" + name + "/route.ts", dependencies);
    const response = await api.POST(
      new Request("http://localhost/render", {
        method: "POST",
        body: JSON.stringify({ force: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "post" }) },
    );
    assert.equal(response.status, 409, name);
  }
});

test("feed persistence serializes concurrent changes and leaves prior state intact on failure", async () => {
  const fixture = path.join(
    root,
    "output",
    "playwright",
    "feed-store-" + crypto.randomUUID(),
  );
  fs.mkdirSync(fixture, { recursive: true });
  try {
    const store = load("lib/brand-feed/store.ts", {
      "server-only": {},
      "./planner": planner,
      __process: { cwd: () => fixture },
    });
    await Promise.all([
      store.mutateFeed("qa", async (s) => {
        await new Promise((r) => setTimeout(r, 15));
        s.context.direction += "first ";
      }),
      store.mutateFeed("qa", (s) => {
        s.context.direction += "second";
      }),
    ]);
    assert.equal(
      (await store.readFeed("qa")).context.direction,
      "first second",
    );
    await assert.rejects(
      store.mutateFeed("qa", (s) => {
        s.context.direction = "should not save";
        throw Error("stop");
      }),
      /stop/,
    );
    assert.equal(
      (await store.readFeed("qa")).context.direction,
      "first second",
    );
    assert.deepEqual(
      fs.readdirSync(path.join(fixture, "storage", "brand-feeds")),
      ["qa.json"],
    );
  } finally {
    assert.ok(
      path
        .resolve(fixture)
        .startsWith(path.resolve(root, "output", "playwright") + path.sep),
    );
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("library hides link-only references and never probes remote thumbnails", async () => {
  let checks = 0;
  const { availableSources } = load("lib/brand-feed/source-availability.ts", {
    "server-only": {},
    "./planner": planner,
    "node:fs/promises": {
      stat: async () => {
        checks++;
        return { isFile: () => true, size: 100 };
      },
    },
  });
  const remote = {
    ...source("expired"),
    thumbnailUrl: "https://cdn.example/expired.jpg",
    media: [],
  };
  const external = {
    ...source("remote"),
    media: [
      { id: "remote", src: "https://cdn.example/expired.mp4", type: "video" },
    ],
  };
  const kept = await availableSources([remote, external, source("local")]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, "local");
  assert.equal(checks, 1);
});
test("library excludes missing, empty and non-file local assets", async () => {
  const { availableSources } = load("lib/brand-feed/source-availability.ts", {
    "server-only": {},
    "./planner": planner,
    "node:fs/promises": {
      stat: async (filename) => {
        if (filename.includes("missing"))
          throw Object.assign(Error("Gone"), { code: "ENOENT" });
        return {
          isFile: () => !filename.includes("directory"),
          size: filename.includes("empty") ? 0 : 100,
        };
      },
    },
  });
  const input = ["missing", "empty", "directory"].map((id) => ({
    ...source(id),
    media: [
      { id, src: "/storage/viral-trend-artifacts/" + id + ".gif", type: "gif" },
    ],
  }));
  assert.equal((await availableSources(input)).length, 0);
});
test("library retains available media even when its thumbnail or another artifact is unavailable", async () => {
  const { availableSources } = load("lib/brand-feed/source-availability.ts", {
    "server-only": {},
    "./planner": planner,
    "node:fs/promises": {
      stat: async (filename) => {
        if (filename.includes("missing")) throw Error("Gone");
        return { isFile: () => true, size: 100 };
      },
    },
  });
  const s = {
    ...source("mixed"),
    thumbnailUrl: "https://cdn.example/expired.jpg",
    ready: false,
  };
  s.media.unshift({
    id: "missing",
    src: "/storage/viral-trend-artifacts/missing.gif",
    type: "gif",
  });
  const result = await availableSources([s]);
  assert.equal(result.length, 1);
  assert.equal(result[0].media.length, 1);
  assert.equal(result[0].media[0].id, "asset");
  assert.equal(result[0].ready, false);
  assert.equal(s.media.length, 2);
});
