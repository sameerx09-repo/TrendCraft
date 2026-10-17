const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript");
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (n) => (n in deps ? deps[n] : require(n)),
      URL,
      Buffer,
      Error,
      process: deps.process || process,
      Date,
    },
  );
  return exports;
}
const policy = load("lib/auth/policy.ts"),
  passwords = load("lib/auth/password.ts");
test("password hashes are salted and verified without storing plaintext", async () => {
  const a = await passwords.hashPassword("example-password-123"),
    b = await passwords.hashPassword("example-password-123");
  assert.notEqual(a, b);
  assert.ok(!a.includes("example-password"));
  assert.equal(await passwords.verifyPassword("example-password-123", a), true);
  assert.equal(await passwords.verifyPassword("wrong-password-123", a), false);
  assert.equal(
    await passwords.verifyPassword("example-password-123", "broken"),
    false,
  );
});
test("credentials normalize email and enforce password bounds", () => {
  assert.equal(
    policy.credentials({
      email: " OWNER@EXAMPLE.COM ",
      password: "123456789012",
    }).email,
    "owner@example.com",
  );
  for (const input of [
    { email: "bad", password: "123456789012" },
    { email: "a@b.com", password: "short" },
    { email: "a@b.com", password: "x".repeat(129) },
  ])
    assert.throws(() => policy.credentials(input));
});
test("brand websites are normalized and private hosts are rejected", () => {
  assert.equal(
    policy.brandDetails({
      brandName: "My Brand",
      website: "https://www.mybrand.com/shop",
    }).domain,
    "mybrand.com",
  );
  for (const site of [
    "localhost",
    "http://127.0.0.1",
    "https://app.local",
    "https://user:pass@mybrand.com",
    "javascript:alert(1)",
  ])
    assert.throws(() =>
      policy.brandDetails({ brandName: "Brand", website: site }),
    );
});
test("login return paths cannot become external redirects or API navigation", () => {
  assert.equal(
    policy.safeReturnPath("/drive-engagement?postId=123"),
    "/drive-engagement?postId=123",
  );
  for (const path of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/api/config",
    "/login",
    null,
  ])
    assert.equal(policy.safeReturnPath(path), "/");
});
test("unsafe cross-site authentication requests are rejected", () => {
  const req = (origin, site) => ({
    url: "https://app.mybrand.com/api/auth/login",
    headers: new Map([
      ["origin", origin],
      ["sec-fetch-site", site],
    ]),
  });
  assert.equal(
    policy.sameOrigin(req("https://app.mybrand.com", "same-origin")),
    true,
  );
  assert.equal(
    policy.sameOrigin(req("https://evil.example", "cross-site")),
    false,
  );
  assert.equal(policy.sameOrigin(req(undefined, undefined)), false);
});
test("private media signatures reject altered paths, invalid signatures and expired links", () => {
  const api = load("lib/auth/media-signature.ts", {
    process: { env: { AUTH_WORKER_TOKEN: "a".repeat(64) } },
  });
  const path = "/storage/rendered-posts/owned.mp4",
    signed = api.signedMediaPath(path),
    url = new URL(signed, "https://app.example");
  assert.equal(api.validMediaSignature(url), true);
  url.pathname = "/storage/rendered-posts/foreign.mp4";
  assert.equal(api.validMediaSignature(url), false);
  url.pathname = path;
  url.searchParams.set("expires", "1000000000");
  assert.equal(api.validMediaSignature(url), false);
});
