const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const {
  chromium,
} = require("C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  postgres = require("postgres");
const base = "http://localhost:3001",
  out = path.resolve("output/playwright"),
  run = crypto.randomUUID().replaceAll("-", "").slice(0, 12),
  prefix = "auth-qa-" + run,
  pass = crypto.randomBytes(24).toString("base64url");
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false }),
    browser = await chromium.launch({
      headless: true,
      executablePath:
        "C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
    });
  const ids = [],
    contexts = [],
    files = [],
    errors = [],
    checks = [];
  const emails = [prefix + "-a@example.invalid", prefix + "-b@example.invalid"],
    ip = prefix;
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
  contexts.push(context);
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  async function post(ctx, action, data, origin = base) {
    return ctx.request.post(base + "/api/auth/" + action, {
      headers: { Origin: origin },
      data,
    });
  }
  async function status(ctx, url, expected) {
    const r = await ctx.request.get(base + url, { maxRedirects: 0 });
    assert.equal(r.status(), expected, url);
    checks.push(url + " " + expected);
    return r;
  }
  try {
    const [{ count: beforeCount }] =
      await sql`SELECT count(*)::int AS count FROM posts WHERE brand_profile_id=(SELECT id FROM brand_profiles WHERE domain='glo-vibe.com' ORDER BY created_at LIMIT 1)`;
    await status(context, "/", 307);
    for (const route of [
      "/api/brand",
      "/api/products",
      "/api/engagement/media",
      "/api/config",
      "/api/inngest",
    ])
      await status(context, route, 401);
    for (const width of [1440, 768, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      await p.goto(base + "/login");
      await p
        .getByRole("heading", { name: "Sign in to your brand", exact: true })
        .waitFor();
      assert.equal(await p.locator(".sidebar").count(), 0);
      for (const mode of ["Sign in", "Create account"]) {
        await p
          .getByRole("button", { name: mode, exact: true })
          .first()
          .click();
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        checks.push("login " + width + " " + mode);
        if ([1440, 390].includes(width))
          await p.screenshot({
            path: path.join(
              out,
              "brand-auth-" + mode.replaceAll(" ", "-") + "-" + width + ".png",
            ),
            fullPage: true,
          });
      }
    }
    // Set up the existing owner's password screen, without claiming the account.
    const setup = JSON.parse(
      fs.readFileSync("storage/auth/owner-setup.json", "utf8"),
    );
    await p.goto(base + "/login#setup=" + setup.token);
    await p
      .getByRole("heading", { name: "Set up GloVibe access", exact: true })
      .waitFor();
    await p.waitForFunction(() =>
      document.querySelector('input[name="email"]')?.value.includes("@"),
    );
    assert.equal(
      await p.getByLabel("Email", { exact: true }).inputValue(),
      setup.email,
    );
    assert.equal(new URL(p.url()).hash, "");
    await p.screenshot({
      path: path.join(out, "brand-auth-owner-setup-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      (await post(context, "setup-info", { token: "0".repeat(64) })).status(),
      403,
    );
    assert.equal(
      (
        await post(
          context,
          "register",
          {
            email: emails[0],
            password: pass,
            brandName: "QA A",
            website: prefix + "-a.example",
          },
          "https://evil.example",
        )
      ).status(),
      403,
    );
    const existing = await post(context, "register", {
      email: emails[0],
      password: pass,
      brandName: "GloVibe",
      website: "glo-vibe.com",
    });
    assert.equal(existing.status(), 400);
    assert.match((await existing.json()).error, /already exists/);
    await p.goto(base + "/login");
    await p
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await p.getByLabel("Brand name", { exact: true }).fill("QA Brand A");
    await p
      .getByLabel("Brand website", { exact: true })
      .fill(prefix + "-a.example");
    await p.getByLabel("Email", { exact: true }).fill(emails[0]);
    await p.getByLabel("Password", { exact: true }).fill(pass);
    await p.getByLabel("Confirm password", { exact: true }).fill(pass);
    await p
      .getByRole("button", { name: "Create account", exact: true })
      .last()
      .click();
    await p.waitForURL(base + "/");
    if (
      await p
        .getByRole("button", { name: "Open navigation", exact: true })
        .isVisible()
    )
      await p
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await p.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    const a = await (
      await context.request.get(base + "/api/auth/session")
    ).json();
    ids.push(a.brand.id);
    assert.equal(a.role, "brand");
    assert.equal(a.brand.name, "QA Brand A");
    const cookies = await context.cookies(),
      cookie = cookies.find((c) => c.name === "trendcraft-session");
    assert.ok(cookie.httpOnly);
    assert.equal(cookie.sameSite, "Lax");
    const [storedUser] =
      await sql`SELECT password_hash FROM auth_users WHERE email=${emails[0]}`;
    assert.ok(storedUser.password_hash.startsWith("scrypt:"));
    assert.ok(!storedUser.password_hash.includes(pass));
    const ctxB = await browser.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": ip },
    });
    contexts.push(ctxB);
    const rB = await post(ctxB, "register", {
      email: emails[1],
      password: pass,
      brandName: "QA Brand B",
      website: prefix + "-b.example",
      role: "owner",
      brandProfileId: a.brand.id,
    });
    assert.equal(rB.status(), 200);
    const b = await (await ctxB.request.get(base + "/api/auth/session")).json();
    ids.push(b.brand.id);
    assert.notEqual(a.brand.id, b.brand.id);
    assert.equal(b.role, "brand");
    const productA = await (
      await context.request.get(base + "/api/products")
    ).json();
    assert.equal(productA.items.length, 0);
    const [foreign] =
      await sql`SELECT id,rendered_file_url FROM posts WHERE rendered_file_url IS NOT NULL AND brand_profile_id NOT IN (${a.brand.id},${b.brand.id}) LIMIT 1`;
    if (foreign) {
      await status(context, "/api/posts/" + foreign.id, 404);
      await status(context, foreign.rendered_file_url, 404);
      assert.equal(
        (
          await context.request.delete(base + "/api/posts/" + foreign.id, {
            headers: { Origin: base },
          })
        ).status(),
        404,
      );
    }
    const [script] =
      await sql`INSERT INTO remixed_scripts(brand_profile_id,hook) VALUES(${b.brand.id},'Auth QA fixture') RETURNING id`;
    const [fixture] =
      await sql`INSERT INTO posts(brand_profile_id,remixed_script_id) VALUES(${b.brand.id},${script.id}) RETURNING id`;
    await status(ctxB, "/api/posts/" + fixture.id, 200);
    await status(context, "/api/posts/" + fixture.id, 404);
    await status(context, "/api/scripts/" + script.id, 404);
    const mediaPath = "/storage/rendered-posts/" + fixture.id + ".mp4",
      disk = path.resolve("storage/rendered-posts/" + fixture.id + ".mp4");
    assert.ok(
      disk.startsWith(path.resolve("storage/rendered-posts") + path.sep),
    );
    fs.copyFileSync("output/playwright/brand-feed-render-check.mp4", disk);
    files.push(disk);
    await sql`UPDATE posts SET rendered_file_url=${mediaPath} WHERE id=${fixture.id}`;
    await status(ctxB, mediaPath, 200);
    await status(context, mediaPath, 404);
    const anonymous = await browser.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": ip },
    });
    contexts.push(anonymous);
    await status(anonymous, mediaPath, 401);
    const expires = String(Math.floor(Date.now() / 1000) + 60),
      signature = crypto
        .createHmac("sha256", process.env.AUTH_WORKER_TOKEN)
        .update(mediaPath + "\n" + expires)
        .digest("hex");
    await status(
      anonymous,
      mediaPath + "?expires=" + expires + "&signature=" + signature,
      200,
    );
    await status(
      anonymous,
      mediaPath + "?expires=" + expires + "&signature=" + "0".repeat(64),
      401,
    );
    assert.equal(
      (
        await context.request.post(base + "/api/config", {
          headers: { Origin: base },
          data: { mockMode: false },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await context.request.post(base + "/api/engagement/submit", {
          headers: { Origin: base },
          data: { testDelivery: "swaybees" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (await post(context, "logout", {}, "https://evil.example")).status(),
      403,
    );
    await status(context, "/api/auth/session", 200);
    const oldCookie = (await context.cookies()).find(
      (c) => c.name === "trendcraft-session",
    );
    await p.getByRole("button", { name: "Sign out", exact: true }).click();
    await p.waitForURL(base + "/login");
    await status(context, "/api/brand", 401);
    await anonymous.addCookies([oldCookie]);
    await status(anonymous, "/api/brand", 401);
    assert.equal(
      (
        await post(context, "login", {
          email: emails[0],
          password: pass + "wrong",
        })
      ).status(),
      401,
    );
    await p.getByLabel("Email", { exact: true }).fill(emails[0]);
    await p.getByLabel("Password", { exact: true }).fill(pass);
    await p
      .getByRole("button", { name: "Sign in", exact: true })
      .last()
      .click();
    await p.waitForURL(base + "/");
    await p.reload();
    if (
      await p
        .getByRole("button", { name: "Open navigation", exact: true })
        .isVisible()
    )
      await p
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await p.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await sql`UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=(SELECT id FROM auth_users WHERE email=${emails[1]})`;
    await status(ctxB, "/api/brand", 401);
    const worker = await anonymous.request.get(
      base + "/api/inngest?workerToken=" + process.env.AUTH_WORKER_TOKEN,
    );
    assert.equal(worker.status(), 200);
    checks.push("Authenticated worker reachable");
    const [{ count: afterCount }] =
      await sql`SELECT count(*)::int AS count FROM posts WHERE brand_profile_id=(SELECT id FROM brand_profiles WHERE domain='glo-vibe.com' ORDER BY created_at LIMIT 1)`;
    assert.equal(beforeCount, afterCount);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "brand-auth-checks.json"),
      JSON.stringify(
        {
          checks,
          errors,
          existingContentPreserved: true,
          ownerPasswordSetByAgent: false,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: brand signup/login/logout, session cookies, expiry/revocation, CSRF, workspace/file isolation, owner setup, authenticated workers and responsive login. Existing GloVibe posts unchanged.",
    );
  } finally {
    for (const ctx of contexts) await ctx.close();
    await browser.close();
    const owned =
      await sql`SELECT id FROM brand_profiles WHERE domain LIKE ${prefix + "-%"}`;
    const brandIds = owned.map((x) => x.id);
    for (const id of brandIds) assert.ok(/^[a-f0-9-]{36}$/.test(id));
    if (brandIds.length) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM posts WHERE brand_profile_id IN ${tx(brandIds)}`;
        await tx`DELETE FROM remixed_scripts WHERE brand_profile_id IN ${tx(brandIds)}`;
        await tx`DELETE FROM auth_users WHERE brand_profile_id IN ${tx(brandIds)}`;
        await tx`DELETE FROM brand_profiles WHERE id IN ${tx(brandIds)}`;
      });
    }
    const keys = ["ip:" + ip, ...emails.map((e) => "email:" + e)].map((x) =>
      crypto.createHash("sha256").update(x).digest("hex"),
    );
    await sql`DELETE FROM auth_attempts WHERE key IN ${sql(keys)}`;
    for (const file of files) fs.unlinkSync(file);
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
