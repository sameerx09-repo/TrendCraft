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
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
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
      URLSearchParams,
      Error,
      Buffer,
      console,
      AbortSignal,
      setTimeout,
      process: deps.__process || process,
      fetch:
        deps.__fetch ||
        (() => {
          throw Error("Unexpected network access");
        }),
    },
  );
  return exports;
}
const policy = load("lib/engagement/media-policy.ts");
const swayMode = load("lib/engagement/swaybees-mode.ts");
const instagram = "https://www.instagram.com/reel/brand-reel/";
const upload = {
  id: "upload-owned",
  kind: "uploaded",
  title: "My UGC",
  videoUrl: "/storage/rendered-posts/engagement-upload-owned.mp4",
  thumbnailUrl: null,
  label: "Brand UGC",
  reviewStatus: "pending",
  publishedUrl: "",
  createdAt: "2026-10-16T00:00:00Z",
};
test("Instagram destinations are canonical published post URLs, not arbitrary media or inspiration fallbacks", () => {
  assert.equal(policy.instagramPostUrl(instagram + "?utm_source=x"), instagram);
  assert.equal(
    policy.instagramPostUrl("https://instagram.com/p/ABC_123"),
    "https://www.instagram.com/p/ABC_123/",
  );
  for (const url of [
    "http://instagram.com/reel/x",
    "https://instagram.com.evil.example/reel/x",
    "https://instagram.com@evil.example/reel/x",
    "https://instagram.com/explore",
    "/storage/rendered-posts/x.mp4",
  ])
    assert.equal(policy.instagramPostUrl(url), null);
});
test("public creator media hosting rejects localhost and private origins", () => {
  assert.equal(
    policy.publicMediaBase("https://ads.mybrand.com"),
    "https://ads.mybrand.com",
  );
  for (const url of [
    "http://localhost:3001",
    "https://localhost",
    "https://127.0.0.1",
    "https://192.168.1.2",
    "https://app.local",
    "https://example.test",
    "https://user:pass@ads.mybrand.com",
  ])
    assert.equal(policy.publicMediaBase(url), null);
});
test("on-post goals need a published URL even when an uploaded file exists", () => {
  for (const goals of [["engagement"], ["reach"], ["ugc", "engagement"]])
    assert.match(
      policy.mediaTargetIssue({
        goals,
        reelUrl: "",
        media: upload,
        publicMediaAvailable: true,
      }),
      /published Instagram/,
    );
  assert.equal(
    policy.mediaTargetIssue({
      goals: ["engagement"],
      reelUrl: instagram,
      media: upload,
      publicMediaAvailable: false,
    }),
    null,
  );
});
test("creator UGC may use a public video file but never a localhost-only reference", () => {
  assert.equal(
    policy.mediaTargetIssue({
      goals: ["ugc"],
      reelUrl: "",
      media: upload,
      publicMediaAvailable: true,
    }),
    null,
  );
  assert.match(
    policy.mediaTargetIssue({
      goals: ["ugc"],
      reelUrl: "",
      media: upload,
      publicMediaAvailable: false,
    }),
    /public video hosting/,
  );
  assert.equal(
    policy.mediaTargetIssue({
      goals: ["ugc"],
      reelUrl: instagram,
      media: upload,
      publicMediaAvailable: false,
    }),
    null,
  );
});
function libraryHarness(publicBase) {
  const state = { uploads: [structuredClone(upload)], publishedLinks: {} },
    queries = [];
  const rows = [
    {
      post: {
        id: "ugc",
        status: "pending",
        renderedFileUrl: "/storage/rendered-posts/ugc.mp4",
        createdAt: new Date("2026-10-16"),
      },
      script: { hook: "Generated UGC", hookType: "ai_ugc" },
    },
    {
      post: {
        id: "kept",
        status: "kept",
        renderedFileUrl: "/storage/rendered-posts/kept.mp4",
        createdAt: new Date("2026-10-15"),
      },
      script: { hook: "Product", hookType: "product_ad" },
    },
    {
      post: {
        id: "missing",
        status: "pending",
        renderedFileUrl: "/storage/rendered-posts/missing.mp4",
        createdAt: new Date("2026-10-15"),
      },
      script: { hook: "Missing", hookType: "ai_ugc" },
    },
  ];
  const exports = load("lib/engagement/media-library.ts", {
    "server-only": {},
    "node:fs/promises": {
      stat: async (p) => {
        if (p.includes("missing")) throw Error("Gone");
        return { isFile: () => true, size: 100 };
      },
    },
    "@/lib/db/client": {
      db: {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: (p) => {
                queries.push(p);
                return { orderBy: async () => rows };
              },
            }),
          }),
        }),
      },
    },
    "@/lib/db/schema": {
      posts: {
        brandProfileId: "brand",
        status: "status",
        renderedFileUrl: "video",
        remixedScriptId: "script",
      },
      remixedScripts: { id: "id" },
    },
    "drizzle-orm": {
      and: (...a) => a,
      eq: (...a) => a,
      ne: (...a) => a,
      isNotNull: (a) => a,
      desc: (a) => a,
    },
    "./media-store": { readMediaState: async () => state },
    "@/lib/auth/media-signature": { signedMediaPath: (path) => path },
    "./media-policy": policy,
    __process: {
      cwd: () => root,
      env: { ENGAGEMENT_PUBLIC_BASE_URL: publicBase },
    },
  });
  return { exports, state, queries };
}
test("library includes completed AI UGC before Keep, plus owned uploads; missing files are hidden", async () => {
  const h = libraryHarness(),
    result = await h.exports.engagementMediaLibrary("brand");
  assert.ok(
    result.items.some(
      (i) =>
        i.id === "post-ugc" &&
        i.reviewStatus === "pending" &&
        i.label === "AI UGC",
    ),
  );
  assert.ok(result.items.some((i) => i.id === "upload-owned"));
  assert.ok(!result.items.some((i) => i.id === "post-missing"));
  assert.equal(result.items.find((i) => i.id === "post-ugc").publishedUrl, "");
  assert.equal(
    result.items.find((i) => i.id === "post-ugc").thumbnailUrl,
    "/storage/rendered-posts/ugc-poster.jpg",
  );
  assert.ok(JSON.stringify(h.queries).includes('["status","discarded"]'));
});
test("only a saved brand-published link is prefilled, never a source reel", async () => {
  const h = libraryHarness();
  h.state.publishedLinks["post-ugc"] = instagram;
  assert.equal(
    (await h.exports.engagementMediaLibrary("brand")).items.find(
      (i) => i.id === "post-ugc",
    ).publishedUrl,
    instagram,
  );
});
test("campaign source must belong to the current brand and match the reviewed video", async () => {
  const h = libraryHarness("https://ads.mybrand.com");
  await assert.rejects(
    h.exports.campaignMediaTarget("brand", {
      mediaId: "upload-foreign",
      reelUrl: instagram,
      goals: ["ugc"],
    }),
    /belong/,
  );
  await assert.rejects(
    h.exports.campaignMediaTarget("brand", {
      mediaId: upload.id,
      expectedVideoUrl: "/other.mp4",
      reelUrl: instagram,
      goals: ["ugc"],
    }),
    /changed/,
  );
});
test("uploaded UGC is referenced by its actual public video, while engagement targets the Instagram post", async () => {
  const h = libraryHarness("https://ads.mybrand.com"),
    result = await h.exports.campaignMediaTarget("brand", {
      mediaId: upload.id,
      expectedVideoUrl: upload.videoUrl,
      reelUrl: instagram,
      goals: ["ugc", "engagement"],
    });
  assert.equal(result.publishedUrl, instagram);
  assert.equal(
    result.referenceUrl,
    "https://ads.mybrand.com" + upload.videoUrl,
  );
});
test("local-only UGC reference blocks launch; a published URL works without file hosting", async () => {
  const h = libraryHarness();
  await assert.rejects(
    h.exports.campaignMediaTarget("brand", {
      mediaId: upload.id,
      expectedVideoUrl: upload.videoUrl,
      reelUrl: "",
      goals: ["ugc"],
    }),
    /public video hosting/,
  );
  assert.equal(
    (
      await h.exports.campaignMediaTarget("brand", {
        mediaId: upload.id,
        expectedVideoUrl: upload.videoUrl,
        reelUrl: instagram,
        goals: ["ugc"],
      })
    ).referenceUrl,
    instagram,
  );
});
function submitHarness(
  targetError,
  publishing = {
    mockMode: false,
    canProceed: true,
    instagramConnected: true,
    error: null,
  },
  upstream = {},
) {
  const calls = [],
    previews = [],
    targets = [];
  const api = load("app/api/engagement/submit/route.ts", {
    "@/lib/engagement/publishing-status": {
      engagementPublishingStatus: () => publishing,
    },
    "@/lib/engagement/test-plan": load("lib/engagement/test-plan.ts"),
    "@/lib/engagement/swaybees-mode": swayMode,
    "@/lib/engagement/media-policy": policy,
    "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
    "@/lib/db/getOrCreateBrand": {
      getOrCreateCurrentBrand: async () => ({
        id: "brand",
        name: "Brand",
        identity: "Skincare",
      }),
    },
    "@/lib/engagement/media-library": {
      campaignMediaTarget: async (id, input) => {
        targets.push(input);
        if (targetError) throw Error(targetError);
        return {
          publishedUrl: instagram,
          referenceUrl: "https://ads.mybrand.com" + upload.videoUrl,
          media: upload,
        };
      },
    },
    "@/lib/engagement/realPreview": {
      fetchRealPreview: async (b, s, g, requestedMode) => {
        previews.push({ goals: g, mode: requestedMode });
        return {
          mode:
            "previewMode" in upstream ? upstream.previewMode : requestedMode,
          totals: { projectedInfluencers: 3 },
          breakdown: g.map((goal) => ({
            type: goal === "ugc" ? "UGC" : "Reach",
            projectedTasks: 3,
            costPerTask: 1,
            budgetUsed: 3,
          })),
        };
      },
      SIMPLE_TYPE_MAP: { UGC: "UGC_VIDEO", Reach: "SHARE" },
      splitEngagementTasks: () => [],
    },
    __process: {
      env: {
        SWAYBEES_API_URL: "https://swaybees.invalid",
        SWAYBEES_API_KEY: "test-only",
      },
    },
    __fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return Response.json({
        taskId: "t",
        mode:
          "responseMode" in upstream
            ? upstream.responseMode
            : JSON.parse(init.body).mode,
        invitationsCreated: 3,
        eligiblePoolSize: 3,
        creators: [{ id: "creator" }],
      });
    },
  });
  async function send(extra = {}) {
    const r = await api.POST(
      new Request("http://localhost/api/engagement/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget: 1000,
          scope: "low",
          goals: ["ugc"],
          mediaId: upload.id,
          expectedVideoUrl: upload.videoUrl,
          reelUrl: instagram,
          reviewed: true,
          testMode: false,
          testDelivery: publishing.mockMode ? "local" : undefined,
          ...extra,
        }),
      }),
    );
    return { status: r.status, body: await r.json() };
  }
  return { calls, previews, targets, send };
}
test("launch requires explicit review before any creator preview or task request", async () => {
  const h = submitHarness();
  assert.equal((await h.send({ reviewed: false })).status, 400);
  assert.equal(h.calls.length, 0);
  assert.equal(h.previews.length, 0);
});
test("unavailable/foreign media blocks launch before SwayBees access", async () => {
  const h = submitHarness("Video does not belong to your brand");
  assert.equal((await h.send()).status, 400);
  assert.equal(h.calls.length, 0);
  assert.equal(h.previews.length, 0);
});
test("UGC task uses the uploaded asset as reference and never an MP4 as an engagement target", async () => {
  const h = submitHarness();
  assert.equal((await h.send({ goals: ["ugc", "reach"] })).status, 200);
  assert.equal(
    h.calls.find((c) => c.body.type === "SHARE").body.targetPostUrl,
    instagram,
  );
  const task = h.calls.find((c) => c.body.type === "UGC_VIDEO").body;
  assert.ok(
    task.description.includes("https://ads.mybrand.com" + upload.videoUrl),
  );
  assert.equal(task.targetPostUrl, undefined);
  assert.equal(h.targets[0].expectedVideoUrl, upload.videoUrl);
});
test("duplicate goals are rejected rather than creating duplicate paid task groups", async () => {
  const h = submitHarness();
  assert.equal((await h.send({ goals: ["ugc", "ugc"] })).status, 400);
  assert.equal(h.calls.length, 0);
});
function routeHarness() {
  let prepared = 0,
    written = 0;
  const state = { uploads: [], publishedLinks: {} };
  const deps = {
    "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
    "@/lib/db/getOrCreateBrand": {
      getOrCreateCurrentBrand: async () => ({ id: "brand" }),
    },
    "@/lib/engagement/media-library": {
      engagementMediaLibrary: async () => ({
        items: [upload],
        publicMediaAvailable: false,
      }),
    },
    "@/lib/engagement/media-store": {
      mutateMediaState: async (id, f) => {
        assert.equal(id, "brand");
        return f(state);
      },
    },
    "@/lib/engagement/media-policy": policy,
    "@/lib/engagement/prepare-upload": {
      prepareEngagementUpload: async () => {
        prepared++;
        return { video: Buffer.from("video"), poster: Buffer.from("poster") };
      },
    },
    "@/lib/storage": {
      put: async (bucket, key) => {
        written++;
        return "/storage/" + bucket + "/" + key;
      },
    },
  };
  return {
    media: load("app/api/engagement/media/route.ts", deps),
    upload: load("app/api/engagement/media/upload/route.ts", deps),
    state,
    get prepared() {
      return prepared;
    },
    get written() {
      return written;
    },
  };
}
test("published-link updates cannot target another brand's video", async () => {
  const h = routeHarness(),
    r = await h.media.PATCH(
      new Request("http://localhost/media", {
        method: "PATCH",
        body: JSON.stringify({ mediaId: "foreign", publishedUrl: instagram }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  assert.equal(r.status, 400);
  assert.equal(Object.keys(h.state.publishedLinks).length, 0);
});
test("published links are saved canonically for the selected owned video", async () => {
  const h = routeHarness(),
    r = await h.media.PATCH(
      new Request("http://localhost/media", {
        method: "PATCH",
        body: JSON.stringify({
          mediaId: upload.id,
          publishedUrl: instagram + "?utm_source=x",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  assert.equal(r.status, 200);
  assert.equal(h.state.publishedLinks[upload.id], instagram);
});
test("upload requires rights consent, then saves owned normalized video and poster", async () => {
  const h = routeHarness(),
    form = () => {
      const f = new FormData();
      f.set("file", new Blob(["video"], { type: "video/mp4" }), "ugc.mp4");
      f.set("title", "My UGC");
      f.set("videoType", "ugc");
      return f;
    };
  let f = form(),
    r = await h.upload.POST(
      new Request("http://localhost/upload", { method: "POST", body: f }),
    );
  assert.equal(r.status, 400);
  assert.equal(h.prepared, 0);
  f = form();
  f.set("rights", "true");
  r = await h.upload.POST(
    new Request("http://localhost/upload", { method: "POST", body: f }),
  );
  assert.equal(r.status, 201);
  assert.equal(h.prepared, 1);
  assert.equal(h.written, 2);
  assert.equal(h.state.uploads[0].label, "Brand UGC");
  assert.equal(h.state.uploads[0].kind, "uploaded");
});
test("upload processor rejects unsupported and oversize files before processing", async () => {
  const processor = load("lib/engagement/prepare-upload.ts", {
    "server-only": {},
    "./media-policy": policy,
  });
  await assert.rejects(
    processor.prepareEngagementUpload({ type: "image/png", size: 20 }),
    /MP4/,
  );
  await assert.rejects(
    processor.prepareEngagementUpload({
      type: "video/mp4",
      size: policy.MAX_VIDEO_BYTES + 1,
    }),
    /50 MB/,
  );
});
test("uploaded video metadata and destinations survive concurrent saves and a fresh read", async () => {
  const fixture = path.join(
    root,
    "output",
    "playwright",
    "engagement-store-" + crypto.randomUUID(),
  );
  fs.mkdirSync(fixture, { recursive: true });
  try {
    const store = load("lib/engagement/media-store.ts", {
      "server-only": {},
      __process: { cwd: () => fixture },
    });
    await Promise.all([
      store.mutateMediaState("brand", async (s) => {
        await new Promise((r) => setTimeout(r, 10));
        s.uploads.push(upload);
      }),
      store.mutateMediaState("brand", (s) => {
        s.publishedLinks[upload.id] = instagram;
      }),
    ]);
    const state = await store.readMediaState("brand");
    assert.equal(state.uploads.length, 1);
    assert.equal(state.publishedLinks[upload.id], instagram);
    assert.deepEqual(
      fs.readdirSync(path.join(fixture, "storage", "engagement-media")),
      ["brand.json"],
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

function loginRoute(env) {
  return load("app/api/engagement/swaybees-login/route.ts", {
    __process: { env },
  });
}
test("SwayBees login uses its configured browser origin without sharing campaign data or credentials", async () => {
  const response = await loginRoute({
    SWAYBEES_WEB_URL: "https://brands.swaybees.example/api?token=unused",
    SWAYBEES_API_URL: "https://api.swaybees.example",
    SWAYBEES_API_KEY: "never-send-this",
  }).GET();
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://brands.swaybees.example/login",
  );
  assert.equal(response.headers.get("authorization"), null);
});
test("SwayBees login falls back to the local API origin on port 5100", async () => {
  const response = await loginRoute({
    SWAYBEES_API_URL: "http://localhost:5100",
  }).GET();
  assert.equal(response.headers.get("location"), "http://localhost:5100/login");
});
test("SwayBees login reports unavailable for missing or unsafe configuration", async () => {
  for (const base of [
    undefined,
    "not-a-url",
    "javascript:alert(1)",
    "https://user:pass@swaybees.example",
  ]) {
    const response = await loginRoute({ SWAYBEES_WEB_URL: base }).GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
  }
});

test("publishing status never fabricates a connected Instagram account", () => {
  for (const mockMode of [true, false]) {
    const api = load("lib/engagement/publishing-status.ts", {
      "server-only": {},
      "@/lib/clients/mockMode": { isMockMode: () => mockMode },
      "./media-policy": policy,
    });
    const status = api.engagementPublishingStatus();
    assert.equal(status.instagramConnected, false);
    assert.equal(status.canProceed, mockMode);
    assert.equal(
      status.testReelUrl,
      mockMode ? policy.TEST_INSTAGRAM_URL : null,
    );
    if (!mockMode)
      assert.match(status.error, /Instagram account is not connected/);
  }
});
test("live launch is blocked before any provider request when Instagram is disconnected", async () => {
  const h = submitHarness(undefined, {
    mockMode: false,
    canProceed: false,
    error: "Instagram is not connected",
  });
  const response = await h.send();
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Instagram/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.previews.length, 0);
  assert.equal(h.targets.length, 0);
});
test("a changed runtime mode invalidates launch rather than contacting creators", async () => {
  for (const mockMode of [true, false]) {
    const h = submitHarness(undefined, { mockMode, canProceed: true });
    assert.equal((await h.send({ testMode: !mockMode })).status, 409);
    assert.equal(h.calls.length, 0);
    assert.equal(h.previews.length, 0);
  }
});
test("test launch simulates results with no SwayBees requests or real task IDs", async () => {
  const h = submitHarness(undefined, { mockMode: true, canProceed: true });
  const response = await h.send({
    testMode: true,
    reelUrl: policy.TEST_INSTAGRAM_URL,
    goals: ["engagement"],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.simulated, true);
  assert.deepEqual(response.body.taskIds, []);
  assert.equal(h.calls.length, 0);
  assert.equal(h.previews.length, 0);
  assert.equal(h.targets.length, 1);
});
test("test launch still requires owned available media and explicit approval", async () => {
  const h = submitHarness("Video does not belong to your brand", {
    mockMode: true,
    canProceed: true,
  });
  assert.equal((await h.send({ testMode: true })).status, 400);
  const h2 = submitHarness(undefined, { mockMode: true, canProceed: true });
  assert.equal(
    (await h2.send({ testMode: true, reviewed: false })).status,
    400,
  );
  assert.equal(h.calls.length + h2.calls.length, 0);
});
test("test Instagram URLs cannot launch a real campaign or be saved as published posts", async () => {
  const h = submitHarness();
  assert.equal(
    (await h.send({ reelUrl: policy.TEST_INSTAGRAM_URL })).status,
    400,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.previews.length, 0);
  const route = routeHarness();
  const response = await route.media.PATCH(
    new Request("http://localhost/api/engagement/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId: upload.id,
        publishedUrl: policy.TEST_INSTAGRAM_URL,
      }),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(route.state.publishedLinks, {});
});
function previewHarness(mockMode, canProceed = mockMode) {
  let providerCalls = 0;
  const api = load("app/api/engagement/preview/route.ts", {
    "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
    "@/lib/engagement/publishing-status": {
      engagementPublishingStatus: () => ({
        mockMode,
        canProceed,
        error: "Instagram is not connected",
      }),
    },
    "@/lib/engagement/test-plan": load("lib/engagement/test-plan.ts"),
    "@/lib/engagement/swaybees-mode": swayMode,
    "@/lib/engagement/realPreview": {
      fetchRealPreview: () => {
        providerCalls++;
        throw Error("Unexpected provider call");
      },
    },
    "@/lib/engagement/fx": { usdToInr: (x) => x * 83 },
  });
  return {
    api,
    calls: () => providerCalls,
    send: (testMode) =>
      api.POST(
        new Request("http://localhost/api/engagement/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            budget: 1500,
            scope: "low",
            goals: ["engagement"],
            testMode,
            testDelivery: mockMode ? "local" : undefined,
          }),
        }),
      ),
  };
}
test("test preview is an explicitly labelled local sample, never a provider quote", async () => {
  const h = previewHarness(true),
    response = await h.send(true),
    body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.simulated, true);
  assert.equal(body.plan.viable, true);
  assert.equal(h.calls(), 0);
});
test("preview rejects disconnected Instagram and changed mode before provider access", async () => {
  const h = previewHarness(false);
  assert.equal((await h.send(false)).status, 409);
  assert.equal(h.calls(), 0);
  const h2 = previewHarness(true);
  assert.equal((await h2.send(false)).status, 409);
  assert.equal(h2.calls(), 0);
});
test("sample plans stay within budget and split engagement tasks without duplicates", () => {
  const { engagementTestPlan } = load("lib/engagement/test-plan.ts");
  for (const scope of ["low", "medium", "high"])
    for (const goals of [
      ["engagement"],
      ["ugc"],
      ["reach", "engagement", "ugc"],
    ]) {
      const plan = engagementTestPlan(1500, scope, goals);
      assert.ok(plan.totalCost <= 1500);
      assert.ok(plan.remainingBudget >= 0);
      assert.equal(
        new Set(plan.taskGroups.map((g) => g.type)).size,
        plan.taskGroups.length,
      );
      assert.equal(
        plan.totalCost,
        plan.taskGroups.reduce((s, g) => s + g.countTasks * g.payoutPerTask, 0),
      );
    }
});

test("Test mode requires explicit delivery and never silently chooses local simulation", () => {
  assert.throws(() => swayMode.engagementExecution(true, undefined), /Choose/);
  assert.equal(swayMode.engagementExecution(true, "local").provider, false);
  const execution = swayMode.engagementExecution(true, "swaybees");
  assert.equal(execution.provider, true);
  assert.equal(execution.mode, "test");
  assert.throws(() => swayMode.engagementExecution(true, "live"), /Choose/);
  assert.throws(
    () => swayMode.engagementExecution(false, "swaybees"),
    /Test mode/,
  );
});
test("explicit SwayBees test delivery sends and returns mode test for every task", async () => {
  const h = submitHarness(undefined, { mockMode: true, canProceed: true });
  const r = await h.send({
    testMode: true,
    testDelivery: "swaybees",
    reelUrl: policy.TEST_INSTAGRAM_URL,
    goals: ["ugc", "reach"],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.simulated, false);
  assert.equal(r.body.mode, "test");
  assert.ok(r.body.taskIds.length > 0);
  assert.equal(h.previews[0].mode, "test");
  assert.equal(h.calls.length, 2);
  for (const c of h.calls) assert.equal(c.body.mode, "test");
});
test("live provider calls send mode live explicitly rather than relying on provider defaults", async () => {
  const h = submitHarness();
  const r = await h.send();
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "live");
  assert.equal(h.previews[0].mode, "live");
  for (const c of h.calls) assert.equal(c.body.mode, "live");
});
test("a mismatched or missing SwayBees preview mode stops dispatch before task creation", async () => {
  for (const previewMode of [undefined, "live"]) {
    const h = submitHarness(
      undefined,
      { mockMode: true, canProceed: true },
      { previewMode },
    );
    const r = await h.send({ testMode: true, testDelivery: "swaybees" });
    assert.equal(r.status, 502);
    assert.equal(h.calls.length, 0);
    assert.match(r.body.error, /did not confirm mode: test/);
  }
});
test("a mismatched task response stops all remaining tasks without live fallback", async () => {
  for (const responseMode of [undefined, "live"]) {
    const h = submitHarness(
      undefined,
      { mockMode: true, canProceed: true },
      { responseMode },
    );
    const r = await h.send({
      testMode: true,
      testDelivery: "swaybees",
      goals: ["ugc", "reach"],
    });
    assert.equal(r.status, 502);
    assert.equal(r.body.modeMismatch, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].body.mode, "test");
    assert.match(r.body.error, /Check SwayBees before retrying/);
  }
});
test("test task delivery still requires review, ownership and matching app mode", async () => {
  const h = submitHarness(undefined, { mockMode: true, canProceed: true });
  assert.equal(
    (
      await h.send({
        testMode: true,
        testDelivery: "swaybees",
        reviewed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (await h.send({ testMode: false, testDelivery: "swaybees" })).status,
    409,
  );
  assert.equal(
    (await h.send({ testMode: true, testDelivery: "live" })).status,
    400,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.previews.length, 0);
  const foreign = submitHarness("Video does not belong to your brand", {
    mockMode: true,
    canProceed: true,
  });
  assert.equal(
    (await foreign.send({ testMode: true, testDelivery: "swaybees" })).status,
    400,
  );
  assert.equal(foreign.previews.length, 0);
});
test("SwayBees preview client explicitly sends mode and rejects absent or mismatched response modes", async () => {
  for (const expected of ["test", "live"]) {
    let captured;
    const client = load("lib/engagement/realPreview.ts", {
      "./fx": { inrToUsd: (x) => x / 83 },
      "./swaybees-mode": swayMode,
      __process: {
        env: {
          SWAYBEES_API_URL: "https://swaybees.invalid",
          SWAYBEES_API_KEY: "test-only",
        },
      },
      __fetch: async (url) => {
        captured = new URL(url);
        return Response.json({
          mode: expected,
          amount: 10,
          types: ["Reach"],
          breakdown: [],
          totals: {
            projectedTasks: 3,
            projectedInfluencers: 3,
            budgetUsed: 8,
            budgetRemaining: 2,
          },
        });
      },
    });
    const result = await client.fetchRealPreview(
      830,
      "low",
      ["reach"],
      expected,
    );
    assert.equal(captured.searchParams.get("mode"), expected);
    assert.equal(result.mode, expected);
  }
  for (const received of [undefined, "live"]) {
    const client = load("lib/engagement/realPreview.ts", {
      "./fx": { inrToUsd: (x) => x / 83 },
      "./swaybees-mode": swayMode,
      __process: {
        env: {
          SWAYBEES_API_URL: "https://swaybees.invalid",
          SWAYBEES_API_KEY: "test-only",
        },
      },
      __fetch: async () => Response.json({ mode: received }),
    });
    await assert.rejects(
      client.fetchRealPreview(830, "low", ["reach"], "test"),
      /did not confirm mode: test/,
    );
  }
});

test("client-supplied live mode cannot override test dispatch", async () => {
  const h = submitHarness(undefined, { mockMode: true, canProceed: true });
  const r = await h.send({
    testMode: true,
    testDelivery: "swaybees",
    mode: "live",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "test");
  assert.equal(h.previews[0].mode, "test");
  for (const c of h.calls) assert.equal(c.body.mode, "test");
});
test("provider test preview route uses confirmed mode and never falls back to sample data", async () => {
  for (const received of ["test", "live", undefined]) {
    const calls = [];
    const api = load("app/api/engagement/preview/route.ts", {
      "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
      "@/lib/engagement/publishing-status": {
        engagementPublishingStatus: () => ({
          mockMode: true,
          canProceed: true,
        }),
      },
      "@/lib/engagement/test-plan": {
        engagementTestPlan: () => {
          throw Error("Unexpected local fallback");
        },
      },
      "@/lib/engagement/swaybees-mode": swayMode,
      "@/lib/engagement/realPreview": {
        fetchRealPreview: async (b, s, g, mode) => {
          calls.push(mode);
          return {
            mode: received,
            totals: { budgetUsedUsd: 3, projectedInfluencers: 3 },
            breakdown: [
              {
                type: "Reach",
                projectedTasks: 3,
                costPerTask: 1,
                budgetUsed: 3,
                eligiblePoolSize: 8,
              },
            ],
          };
        },
        SIMPLE_TYPE_MAP: { Reach: "SHARE" },
      },
      "@/lib/engagement/fx": { usdToInr: (x) => x * 83 },
    });
    const response = await api.POST(
      new Request("http://localhost/api/engagement/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget: 1500,
          scope: "low",
          goals: ["reach"],
          testMode: true,
          testDelivery: "swaybees",
        }),
      }),
    );
    const body = await response.json();
    assert.deepEqual(calls, ["test"]);
    if (received === "test") {
      assert.equal(response.status, 200);
      assert.equal(body.simulated, false);
      assert.equal(body.mode, "test");
      assert.equal(body.plan.taskGroups[0].type, "SHARE");
    } else {
      assert.equal(response.status, 502);
      assert.equal(body.plan, undefined);
    }
  }
});
