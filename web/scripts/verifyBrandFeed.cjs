const {
  chromium,
} = require("C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs"),
  path = require("node:path");
const base = "http://localhost:3001",
  out = path.resolve(__dirname, "../output/playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  });
  try {
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [],
      writes = [],
      checks = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const actual = await (
      await context.request.get(base + "/api/brand-feed")
    ).json();
    if (!actual.feed?.ideas?.length) throw Error("No real draft feed");
    let data = structuredClone(actual),
      fail = false;
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.pathname === "/api/brand-feed") {
        if (req.method() === "GET")
          return route.fulfill({
            status: fail ? 500 : 200,
            json: fail ? { error: "QA connection unavailable" } : data,
          });
        const body = req.postDataJSON();
        writes.push(body);
        const idea = data.feed.ideas.find((i) => i.id === body.ideaId);
        if (body.action === "decision") idea.decision = body.decision;
        if (body.action === "edit") {
          idea.scenes.forEach((s, i) => (s.caption = body.captions[i]));
          idea.revision++;
        }
        if (body.action === "context") data.feed.context = body.context;
        if (body.action === "assemble")
          idea.job = {
            postId: "qa",
            state: "queued",
            updatedAt: new Date().toISOString(),
          };
        if (body.action === "batch") {
          data.feed.ideas = data.feed.ideas.map((i) => ({
            ...i,
            decision: i.decision === "skipped" ? "new" : i.decision,
          }));
        }
        return route.fulfill({
          status: body.action === "assemble" ? 202 : 200,
          json: { ok: true, queued: body.action === "assemble" },
        });
      }
      if (
        url.pathname === "/api/brand-feed/samples" &&
        req.method() === "POST"
      ) {
        writes.push({
          action: "upload",
          payload: req.postData().includes("QA reference"),
        });
        return route.fulfill({ status: 201, json: { sample: { id: "qa" } } });
      }
      if (!["GET", "HEAD"].includes(req.method()))
        throw Error("Unexpected live mutation: " + url.pathname);
      return route.continue();
    });
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of ["/", "/kept-reels", "/reel-library"]) {
        await page.goto(base + route);
        await page.waitForSelector(".bf-page-heading", { timeout: 60000 });
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          title: document.querySelector("h1")?.textContent,
        }));
        if (layout.overflow) throw Error("Overflow " + route + " " + width);
        checks.push({ width, route, ...layout });
        if (route === "/")
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".bf-visual img")].every(
              (i) => i.complete && i.naturalWidth > 0,
            ),
          );
        if (route === "/" && [1440, 390].includes(width))
          await page.screenshot({
            path: path.join(out, "brand-feed-" + width + ".png"),
            fullPage: true,
          });
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(base);
    await page.waitForSelector(".bf-reel");
    const originalId = data.feed.ideas[0].id;
    await page
      .locator(".bf-card-actions")
      .first()
      .getByRole("button", { name: "Keep", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "Idea kept" }).waitFor();
    await page.goto(base + "/kept-reels");
    await page.waitForSelector(".bf-reel");
    if ((await page.locator(".bf-reel").count()) !== 1)
      throw Error("Kept view");
    await page.reload();
    await page.waitForSelector(".bf-reel");
    if ((await page.locator(".bf-reel").count()) !== 1)
      throw Error("Reload persistence");
    await page.locator(".bf-play").first().click();
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await page.waitForTimeout(1300);
    const elapsed = await page
      .locator(".bf-player-controls input")
      .inputValue();
    if (Number(elapsed) < 0.8) throw Error("Playback clock");
    await page
      .getByRole("button", { name: "Pause preview", exact: true })
      .click();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page
      .locator(".bf-edit-form textarea")
      .first()
      .fill("My skincare moment, remixed for GloVibe.");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "updated" }).waitFor();
    if (
      !(await page
        .locator(".bf-beats")
        .innerText()
        .then((x) => x.includes("My skincare moment")))
    )
      throw Error("Edit preview");
    await page
      .getByRole("button", { name: "Review & assemble", exact: true })
      .click();
    const approve = page.getByRole("button", {
      name: "Approve & assemble",
      exact: true,
    });
    if (await approve.isEnabled()) throw Error("Approval gate");
    await page.locator("dialog input[type=checkbox]").check();
    await approve.click();
    await page.getByRole("status").filter({ hasText: "queued" }).waitFor();
    if (!data.feed.ideas.find((i) => i.id === originalId).job)
      throw Error("Queue UI");
    await page.getByRole("button", { name: /Back to/ }).click();
    if (
      !(await page
        .getByRole("button", { name: "Find more ideas", exact: true })
        .isEnabled())
    )
      throw Error("Queue kept button busy");
    await page.goto(base);
    await page.waitForSelector(".bf-reel");
    await page
      .getByRole("button", { name: "Product remixes", exact: true })
      .click();
    if ((await page.locator(".bf-reel").count()) !== 1)
      throw Error("Product filter");
    await page.locator(".bf-play").click();
    if (await page.locator(".bf-source-inspector").count())
      throw Error("Product shows original by default");
    await page.getByRole("button", { name: /Back to/ }).click();
    await page.getByRole("button", { name: "All ideas", exact: true }).click();
    await page.locator(".bf-focus select").selectOption("message");
    if (
      await page
        .locator(".bf-source-label")
        .allTextContents()
        .then((xs) => xs.some((x) => x.includes("Product")))
    )
      throw Error("Message filter");
    await page
      .getByRole("button", { name: "Change direction", exact: true })
      .click();
    await page
      .getByLabel("Creative direction", { exact: true })
      .fill("Message-led only. No product shots.");
    await page
      .getByRole("button", { name: "Save direction", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Direction saved" })
      .waitFor();
    if (data.feed.context.direction !== "Message-led only. No product shots.")
      throw Error("Context");
    await page.goto(base + "/reel-library");
    await page.waitForSelector(".bf-page-heading");
    await page
      .getByRole("button", { name: "Add reference", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Reference title", { exact: true })
      .fill("QA reference");
    await page.getByLabel("Media file", { exact: true }).setInputFiles({
      name: "sample.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a"),
    });
    await page.locator("dialog input[name=rights]").check();
    await page
      .locator("dialog")
      .getByRole("button", { name: "Add reference", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Reference added" })
      .waitFor();
    if (!writes.some((w) => w.action === "upload" && w.payload))
      throw Error("Upload UI");
    await page.goto(base + "/workspace");
    await page.waitForSelector(".mc-tabs", { timeout: 60000 });
    if (
      !(await page
        .getByRole("button", { name: "Preview producer", exact: true })
        .count())
    )
      throw Error("Producer preservation");
    await page
      .getByRole("button", { name: "Preview producer", exact: true })
      .click();
    await page
      .waitForSelector(".pa-producer,.pa-agent,.pa-header", { timeout: 10000 })
      .catch(() => {});
    await page.goto(base);
    await page.waitForSelector(".bf-page-heading");
    await page.setViewportSize({ width: 320, height: 850 });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    if (
      !(await page
        .getByRole("link", { name: "Workspace", exact: true })
        .first()
        .isVisible())
    )
      throw Error("Mobile nav");
    fail = true;
    await page.reload();
    await page
      .getByRole("alert")
      .filter({ hasText: "QA connection unavailable" })
      .waitFor();
    if (errors.length) throw Error(errors.join("\n"));
    fs.writeFileSync(
      path.join(out, "brand-feed-ui-checks.json"),
      JSON.stringify(
        { checks, writes: writes.map((w) => w.action), errors },
        null,
        2,
      ),
    );
    console.log(
      "PASS: " +
        checks.length +
        " responsive route checks; keep/reload/edit/playback/approval/queue/filter/direction/upload/workspace/mobile/error flows. Live writes blocked.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
