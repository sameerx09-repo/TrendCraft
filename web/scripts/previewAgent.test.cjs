const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
function moduleAt(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name) =>
      name in dependencies ? dependencies[name] : require(name),
    crypto: crypto.webcrypto,
    structuredClone,
    Request,
    URL,
    Buffer,
    console,
    setTimeout,
    AbortSignal,
    Response,
    fetch: dependencies.__fetch || fetch,
  });
  return exports;
}
const planner = moduleAt("lib/mission-control/preview-plan.ts");
const auth = moduleAt("lib/mission-control/agent-render-authorization.ts", {
  "server-only": {},
});
const product = {
  id: "product",
  title: "Night Renewal Cream",
  description: "Night cream",
  imageUrl: "https://brand.example/cream.jpg",
  productType: "Cream",
  sourceUrl: "https://brand.example/cream",
};
const brief = {
  name: "Night care",
  productId: "product",
  goal: "Introduce an evening ritual",
  audience: "Skincare shoppers",
  language: "english",
  tone: "Warm",
  message: "",
  preferences: "Subtle gestures",
  creditCap: 300,
};
const personas = [
  {
    id: "meera",
    label: "Meera",
    status: "live",
    clips: {
      setup: [
        {
          videoSrc: "persona-library/hook.mp4",
          durationInFrames: 121,
          label: "calm eye contact",
        },
      ],
      button: [
        {
          videoSrc: "persona-library/point.mp4",
          durationInFrames: 121,
          label: "point to camera",
        },
        {
          videoSrc: "persona-library/nod.mp4",
          durationInFrames: 121,
          label: "confident nod",
        },
      ],
    },
  },
];
function makePlan() {
  const plan = planner.buildPreviewPlan({
    brief,
    directions: [],
    product,
    brandName: "Brand",
    personas,
  });
  plan.reference = {
    src: "/storage/viral-trend-artifacts/preview-reference-00000000-0000-4000-8000-000000000000.jpg",
    sha256: crypto.createHash("sha256").update("fixture-image").digest("hex"),
  };
  return plan;
}
function harness() {
  let campaigns = [
      {
        id: "campaign",
        brief: { ...brief },
        directions: [],
        creatives: [],
        activity: [],
        reservedCredits: 0,
        paused: false,
        previewPlan: makePlan(),
      },
    ],
    lock = Promise.resolve();
  const jobs = [],
    inserted = [],
    captured = [],
    outbound = [];
  const store = {
    readCampaigns: async () => structuredClone(campaigns),
    mutateCampaigns: async (_, fn) => {
      const operation = lock.then(() => fn(campaigns));
      lock = operation.catch(() => {});
      return operation;
    },
    addActivity: (c, message) => c.activity.push({ message }),
  };
  const schema = {
    products: "products",
    posts: "posts",
    remixedScripts: "scripts",
    trendItems: "trends",
    brandProfiles: "brands",
  };
  const db = {
    select: () => ({
      from: (table) => ({
        where: async () =>
          table === "products"
            ? [product]
            : inserted.filter((x) => x.table === "posts").map((x) => x.value),
      }),
    }),
    transaction: async (fn) =>
      fn({
        insert: (table) => ({
          values: (value) => {
            inserted.push({ table, value });
            return {
              returning: async () => [{ id: crypto.randomUUID(), ...value }],
            };
          },
        }),
      }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const deps = {
    __fetch: async () =>
      new Response(Buffer.from("fixture-image"), {
        headers: { "content-type": "image/jpeg" },
      }),
    "server-only": {},
    "next/server": {
      after: (fn) => jobs.push(fn),
      NextResponse: {
        json: (data, { status = 200 } = {}) => ({ data, status }),
      },
    },
    "drizzle-orm": { and: () => {}, eq: () => {} },
    "@/lib/db/client": { db },
    "@/lib/db/schema": schema,
    "@/lib/render/personaLibrary": {
      ALL_PERSONAS: personas,
      getPersonaById: () => personas[0],
    },
    "@/lib/clients/reelCopywriter": {
      generateReelCopy: async () => {
        outbound.push("copywriting");
        return ["Hook", "Product", "CTA"];
      },
    },
    "@/lib/clients/mockMode": { isMockMode: () => false },
    "@/lib/db/ttlCache": { invalidateTtlCache: () => {} },
    "@/lib/storage": {
      get: async () => Buffer.from("fixture-image"),
      put: async (bucket, key) => "/storage/" + bucket + "/" + key,
    },
    "@/lib/render/poster": { savePosterFrame: async () => {} },
    "./store": store,
    "./preview-plan": planner,
    "./agent-render-authorization": auth,
    "@/lib/render/renderRunwayMultiClip": {
      renderPersonaLibraryRemix: async (input) => {
        captured.push(input);
        return Buffer.from("test");
      },
    },
    "@/app/api/product-ads/[postId]/render/route": {
      POST: async (req, { params }) => {
        const { postId } = await params,
          authorization = auth.agentRenderAuthorization(req, postId);
        assert.ok(authorization, "Internal authorization missing");
        assert.ok(
          authorization.imageDataUri?.startsWith("data:image/jpeg;base64,"),
          "Pilot did not use verified reference bytes",
        );
        outbound.push("runway");
        await authorization.onTaskCreated("provider-task");
        return {
          ok: true,
          json: async () => ({ renderedFileUrl: "/pilot.mp4" }),
        };
      },
    },
  };
  const actions = moduleAt("lib/mission-control/preview-actions.ts", deps);
  const send = (body) =>
    actions.handlePreviewAction(
      new Request("http://localhost:3001/api/mission-control"),
      {
        campaignId: "campaign",
        planId: campaigns[0].previewPlan.id,
        conceptId: campaigns[0].previewPlan.concepts[0].id,
        ...body,
      },
      { id: "brand", name: "Brand" },
    );
  return {
    get c() {
      return campaigns[0];
    },
    send,
    jobs,
    inserted,
    captured,
    outbound,
    deps,
    db,
    store,
  };
}
test("previews reuse real assets, avoid pointing, keep packaging as the original image", () => {
  const plan = makePlan();
  assert.equal(plan.concepts.length, 2);
  assert.equal(plan.concepts[0].scenes[1].src, product.imageUrl);
  assert.equal(plan.concepts[0].scenes[2].src, "/persona-library/nod.mp4");
  assert.equal(plan.copySource, "catalog");
  assert.ok(plan.concepts[1].scenes.every((s) => s.type === "image"));
  assert.ok(!JSON.stringify(plan).includes("3 days"));
});
test("missing product images are rejected", () =>
  assert.throws(
    () =>
      planner.buildPreviewPlan({
        brief,
        directions: [],
        product: { ...product, imageUrl: null },
        brandName: "Brand",
        personas,
      }),
    /reference image/,
  ));
test("approval is invalidated by revised briefs, images, feedback or versions", () => {
  const plan = makePlan(),
    hash = planner.previewInputHash(brief, [], product, "Brand");
  assert.doesNotThrow(() =>
    planner.assertPreviewCurrent(plan, plan.id, hash, false),
  );
  for (const changed of [
    planner.previewInputHash(
      { ...brief, message: "Changed" },
      [],
      product,
      "Brand",
    ),
    planner.previewInputHash(brief, ["Different direction"], product, "Brand"),
    planner.previewInputHash(
      brief,
      [],
      { ...product, imageUrl: "/new.jpg" },
      "Brand",
    ),
  ])
    assert.throws(
      () => planner.assertPreviewCurrent(plan, plan.id, changed, false),
      /changed/,
    );
  assert.throws(
    () => planner.assertPreviewCurrent(plan, "old", hash, false),
    /replaced/,
  );
  assert.throws(
    () => planner.assertPreviewCurrent(plan, plan.id, hash, true),
    /Resume/,
  );
});
test("preparation does not call copywriting, rendering or Runway", async () => {
  const h = harness();
  await h.send({ action: "preview-prepare" });
  assert.equal(h.outbound.length, 0);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.inserted.length, 0);
  assert.equal(h.c.reservedCredits, 0);
});
test("no production is queued without an explicit reviewed approval", async () => {
  const h = harness();
  await assert.rejects(
    h.send({ action: "preview-pilot", maxCredits: 48 }),
    /Review/,
  );
  await assert.rejects(
    h.send({ action: "preview-assemble", reviewed: "true" }),
    /Review/,
  );
  assert.equal(h.jobs.length, 0);
  assert.equal(h.c.reservedCredits, 0);
});
test("the pilot credit cap is enforced before a post or provider task is created", async () => {
  const h = harness();
  h.c.brief.creditCap = 0;
  h.c.previewPlan = planner.buildPreviewPlan({
    brief: h.c.brief,
    directions: [],
    product,
    brandName: "Brand",
    personas,
  });
  h.c.previewPlan.reference = makePlan().reference;
  await assert.rejects(
    h.send({ action: "preview-pilot", reviewed: true, maxCredits: 48 }),
    /credit cap/,
  );
  assert.equal(h.jobs.length, 0);
  assert.equal(h.inserted.length, 0);
});
test("a mismatched credit authorization is rejected", async () => {
  const h = harness();
  await assert.rejects(
    h.send({ action: "preview-pilot", reviewed: true, maxCredits: 100 }),
    /single-shot/,
  );
  assert.equal(h.c.reservedCredits, 0);
});
test("concurrent duplicate pilot approvals reserve once and queue one attempt", async () => {
  const h = harness(),
    body = { action: "preview-pilot", reviewed: true, maxCredits: 48 };
  const [a, b] = await Promise.all([h.send(body), h.send(body)]);
  assert.equal(a.data.postId, b.data.postId);
  assert.equal(h.c.reservedCredits, 48);
  assert.equal(h.jobs.length, 1);
  await h.jobs[0]();
  assert.deepEqual(h.outbound, ["runway"]);
  assert.equal(h.c.previewPlan.pilot.providerTaskId, "provider-task");
  assert.equal(h.c.previewPlan.pilot.state, "complete");
  await h.send(body);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.c.reservedCredits, 48);
});
test("failed pilots cannot silently queue another paid attempt", async () => {
  const h = harness(),
    body = { action: "preview-pilot", reviewed: true, maxCredits: 48 };
  const first = await h.send(body);
  h.c.previewPlan.pilot.state = "failed";
  h.c.creatives[0].state = "failed";
  const retry = await h.send(body);
  assert.equal(retry.data.postId, first.data.postId);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.c.reservedCredits, 48);
});
test("assembly renders the approved frozen scenes with zero Runway calls", async () => {
  const h = harness();
  const captions = h.c.previewPlan.concepts[0].scenes.map((s) => s.caption);
  await h.send({ action: "preview-assemble", reviewed: true });
  await h.jobs[0]();
  assert.equal(h.c.reservedCredits, 0);
  assert.equal(h.outbound.length, 0);
  assert.equal(h.captured.length, 1);
  assert.deepEqual(
    Array.from(h.captured[0].clips, (s) => s.caption),
    Array.from(captions),
  );
  assert.ok(
    h.captured[0].clips.every((s) => s.fit === "contain" && s.muted && s.still),
  );
});
test("changing the campaign before dispatch stops the paid request", async () => {
  const h = harness();
  await h.send({ action: "preview-pilot", reviewed: true, maxCredits: 48 });
  h.c.brief.message = "Changed after approval";
  await h.jobs[0]();
  assert.equal(h.outbound.length, 0);
  assert.equal(h.c.previewPlan.pilot.state, "failed");
});
test("copy revisions issue a new version and clear production approvals", async () => {
  const h = harness(),
    old = h.c.previewPlan.id;
  await h.send({
    action: "preview-revise",
    captions: ["New hook", "Real product", "Explore Brand"],
  });
  assert.notEqual(h.c.previewPlan.id, old);
  assert.equal(h.c.previewHistory[0].id, old);
  assert.ok(h.c.previewPlan.concepts.every((c) => !c.approvedAt && !c.postId));
});
test("a plain browser Request cannot authorize an Agent pilot", () => {
  const req = new Request("http://localhost/api/product-ads/test/render");
  assert.equal(auth.agentRenderAuthorization(req, "test"), undefined);
  const internal = auth.agentRenderRequest(req.url, "test", async () => {});
  assert.ok(auth.agentRenderAuthorization(internal, "test"));
  assert.equal(auth.agentRenderAuthorization(internal, "other"), undefined);
});

test("Workspace rendering cannot reuse an Agent spending approval", async () => {
  const h = harness();
  h.c.creatives = [
    {
      postId: "agent-post",
      previewPlanId: h.c.previewPlan.id,
      state: "failed",
      engine: "product",
    },
  ];
  const query = {
    from() {
      return this;
    },
    innerJoin() {
      return this;
    },
    where: async () => [
      { post: { id: "agent-post" }, script: { hookType: "product_ad" } },
    ],
  };
  const dependencies = {
    ...h.deps,
    "@/lib/mission-control/preview-actions": {
      handlePreviewAction: () => {
        throw Error("unexpected");
      },
    },
    "@/lib/db/client": { db: { select: () => query } },
    "@/lib/db/getOrCreateBrand": {
      getOrCreateCurrentBrand: async () => ({ id: "brand", name: "Brand" }),
    },
    "@/lib/mission-control/store": h.store,
    "@/lib/mission-control/types": moduleAt("lib/mission-control/types.ts"),
  };
  const route = moduleAt("app/api/mission-control/route.ts", dependencies);
  const result = await route.POST(
    new Request("http://localhost/api/mission-control", {
      method: "POST",
      body: JSON.stringify({
        action: "render",
        campaignId: "campaign",
        postId: "agent-post",
      }),
    }),
  );
  assert.equal(result.status, 400);
  assert.match(result.data.error, /Agent preview/);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.c.reservedCredits, 0);
});
test("the public product renderer rejects an Agent pilot before provider access", async () => {
  const h = harness();
  h.c.creatives = [{ postId: "pilot", agentPilot: true }];
  const query = {
    from() {
      return this;
    },
    innerJoin() {
      return this;
    },
    leftJoin() {
      return this;
    },
    where: async () => [
      {
        post: { id: "pilot", brandProfileId: "brand" },
        script: { hookType: "product_ad" },
        trendItem: { thumbnailUrl: product.imageUrl },
        brand: { name: "Brand" },
      },
    ],
  };
  const route = moduleAt("app/api/product-ads/[postId]/render/route.ts", {
    ...h.deps,
    "@/lib/db/client": { db: { select: () => query } },
    "@/lib/mission-control/store": h.store,
    "@/lib/mission-control/agent-render-authorization": auth,
  });
  const result = await route.POST(
    new Request("http://localhost/api/product-ads/pilot/render", {
      method: "POST",
    }),
    { params: Promise.resolve({ postId: "pilot" }) },
  );
  assert.equal(result.status, 403);
  assert.match(result.data.error, /single-shot approval/);
  assert.equal(h.outbound.length, 0);
});
test("a reviewed pilot produces a new rough-cut option without another generation", async () => {
  const h = harness();
  await h.send({ action: "preview-pilot", reviewed: true, maxCredits: 48 });
  await h.jobs[0]();
  h.inserted.find((x) => x.table === "posts").value.renderedFileUrl =
    "/storage/rendered-posts/pilot.mp4";
  await assert.rejects(
    h.send({ action: "preview-use-pilot", reviewed: false }),
    /Review/,
  );
  const result = await h.send({ action: "preview-use-pilot", reviewed: true });
  const motion = h.c.previewPlan.concepts.find(
    (c) => c.id === result.data.conceptId,
  );
  assert.ok(motion);
  assert.equal(motion.scenes[1].type, "video");
  assert.equal(motion.scenes[1].src, "/storage/rendered-posts/pilot.mp4");
  assert.equal(motion.approvedAt, undefined);
  assert.equal(motion.postId, undefined);
  assert.equal(h.jobs.length, 1);
  assert.deepEqual(h.outbound, ["runway"]);
});
test("test mode never presents fabricated model output as AI refinement", async () => {
  const h = harness();
  h.deps["@/lib/clients/mockMode"].isMockMode = () => true;
  await assert.rejects(h.send({ action: "preview-refine" }), /Test mode/);
  assert.equal(h.outbound.length, 0);
});

test("tampered frozen reference bytes block credit reservation and production", async () => {
  const h = harness();
  h.deps["@/lib/storage"].get = async () => Buffer.from("changed-image");
  await assert.rejects(
    h.send({ action: "preview-pilot", reviewed: true, maxCredits: 48 }),
    /reference changed/,
  );
  assert.equal(h.jobs.length, 0);
  assert.equal(h.c.reservedCredits, 0);
  assert.equal(h.outbound.length, 0);
});
test("pilots use the saved reference, not a mutable catalog image URL", async () => {
  const h = harness();
  await h.send({ action: "preview-pilot", reviewed: true, maxCredits: 48 });
  assert.equal(
    h.inserted.find((x) => x.table === "trends").value.thumbnailUrl,
    h.c.previewPlan.reference.src,
  );
  await h.jobs[0]();
  assert.deepEqual(h.outbound, ["runway"]);
});
test("test mode blocks paid pilots before reserving credits", async () => {
  const h = harness();
  h.deps["@/lib/clients/mockMode"].isMockMode = () => true;
  await assert.rejects(
    h.send({ action: "preview-pilot", reviewed: true, maxCredits: 48 }),
    /disabled in Test mode/,
  );
  assert.equal(h.jobs.length, 0);
  assert.equal(h.c.reservedCredits, 0);
});
test("catalog previews respect Hinglish without inventing product claims", () => {
  const plan = planner.buildPreviewPlan({
    brief: { ...brief, language: "hinglish" },
    directions: [],
    product,
    brandName: "Brand",
    personas,
  });
  assert.match(plan.concepts[0].scenes[0].caption, /Raat|Routine|routine/);
  assert.match(plan.concepts[0].scenes[2].caption, /explore karein/);
  assert.equal(plan.concepts[0].scenes[1].caption, product.title);
});
