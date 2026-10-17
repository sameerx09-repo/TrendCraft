const {
  chromium,
} = require("C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const path = require("path"),
  fs = require("fs"),
  out = path.resolve(__dirname, "../output/playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1100 },
    });
    const page = await context.newPage(),
      errors = [],
      blocked = [],
      checks = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/api/**", (route) => {
      const r = route.request();
      if (r.method() === "POST") {
        const data = r.postDataJSON() || {};
        if (!["preview-prepare", "preview-revise"].includes(data.action)) {
          blocked.push(r.url() + " " + data.action);
          return route.abort();
        }
      }
      return route.continue();
    });
    await page.goto("http://localhost:3001/workspace");
    await page.locator(".mc-engine-grid").waitFor();
    const options = await page
      .getByLabel("Select campaign", { exact: true })
      .locator("option")
      .allTextContents();
    const index = options.findIndex((s) => s.includes("Night care launch"));
    if (index < 0) throw Error("Expected existing Night care launch campaign");
    const value = await page
      .getByLabel("Select campaign", { exact: true })
      .locator("option")
      .nth(index)
      .getAttribute("value");
    await page
      .getByLabel("Select campaign", { exact: true })
      .selectOption(value);
    await page.getByRole("button", { name: "Preview producer", exact: true }).click();
    const previousPlan = await page
      .locator(".pa-agent")
      .getAttribute("data-preview-id");
    if (!(await page.locator(".pa-stage").count()))
      await page
        .getByRole("button", { name: "Prepare rough cuts", exact: false })
        .click();
    else
      await page
        .getByRole("button", { name: "Revise rough cuts", exact: false })
        .click();
    await page.waitForFunction((previous) => {
      const id = document
        .querySelector(".pa-agent")
        ?.getAttribute("data-preview-id");
      return id && id !== previous;
    }, previousPlan);
    await page.locator(".pa-stage video").waitFor();
    await page.waitForFunction(
      () => document.querySelector(".pa-stage video")?.readyState >= 2,
    );
    const approval = page.getByLabel(
      "I approve the script, product reference and pacing.",
      { exact: true },
    );
    const assemble = page.getByRole("button", {
      name: "Approve & assemble",
      exact: true,
    });
    if (!(await assemble.isDisabled()))
      throw Error("Production enabled without approval");
    await page
      .getByRole("button", { name: "Play rough cut", exact: true })
      .click();
    await page.waitForTimeout(850);
    const a = await page.locator(".pa-stage").screenshot();
    await page.waitForTimeout(850);
    const b = await page.locator(".pa-stage").screenshot();
    if (a.equals(b)) throw Error("Rough cut video is not moving");
    const pause = page.getByRole("button", {
      name: "Pause rough cut",
      exact: true,
    });
    if (await pause.count()) await pause.click();
    await page.getByRole("button", { name: /Product.*4s/ }).click();
    const source = await page.locator(".pa-stage img").getAttribute("src");
    if (!source || source.includes("persona-library"))
      throw Error("Product beat did not use catalog image");
    await approval.check();
    await assemble.click();
    await page
      .getByRole("dialog")
      .getByText("0 credits", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Keep previewing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review single-shot spending", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("Up to 48 credits / One attempt", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Keep previewing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Product in focus", exact: true })
      .click();
    if (await approval.isChecked())
      throw Error("Approval persisted across concepts");
    for (const width of [1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const title of ["The evening ritual", "Product in focus"]) {
        await page
          .getByRole("button", { name: new RegExp("^" + title) })
          .click();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        );
        checks.push({ width, title, overflow });
        await page.screenshot({
          path: path.join(
            out,
            "preview-agent-" +
              title.replaceAll(" ", "-") +
              "-" +
              width +
              ".png",
          ),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("button", { name: /^The evening ritual/ }).click();
    await approval.check();
    await page
      .getByRole("button", { name: "Review single-shot spending", exact: true })
      .click();
    await page.screenshot({
      path: path.join(out, "preview-agent-spending-mobile.png"),
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      )
    )
      throw Error("Approval dialog overflow");
    await page
      .getByRole("button", { name: "Keep previewing", exact: true })
      .click();
    await page.reload();
    await page.locator(".pa-stage").waitFor();
    if (await approval.isChecked())
      throw Error("Approval survived page reload");
    const tab = await page
      .getByRole("button", { name: "Preview producer", exact: true })
      .getAttribute("aria-pressed");
    if (tab !== "true") throw Error("Agent mode was not restored");
    const initialData = await (
      await context.request.get("http://localhost:3001/api/mission-control")
    ).json();
    const sample = initialData.campaigns.find(
      (c) => c.brief.name === "Night care launch",
    );
    const freshData = { ...initialData, campaigns: [] };
    const firstContext = await browser.newContext({
      viewport: { width: 390, height: 900 },
    });
    const first = await firstContext.newPage();
    const starts = [];
    await firstContext.route("**/api/mission-control", async (route) => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill({ json: freshData });
      const body = request.postDataJSON();
      starts.push(body.action);
      if (body.action === "create") {
        freshData.campaigns = [
          {
            ...sample,
            id: "first-campaign-check",
            brief: body.brief,
            previewPlan: undefined,
            creatives: [],
            activity: [],
            reservedCredits: 0,
          },
        ];
        return route.fulfill({ json: { campaign: freshData.campaigns[0] } });
      }
      if (body.action === "preview-prepare") {
        const plan = structuredClone(sample.previewPlan);
        plan.input.brief = freshData.campaigns[0].brief;
        freshData.campaigns[0].previewPlan = plan;
        return route.fulfill({ json: { plan } });
      }
      throw Error("Unexpected first-campaign production request");
    });
    await first.goto("http://localhost:3001/workspace");
    await first.locator(".mc-engine-grid").waitFor();
    await first.getByRole("button", { name: "Preview producer", exact: true }).click();
    await first
      .getByLabel("Product", { exact: true })
      .selectOption(sample.brief.productId);
    await first
      .getByLabel("Campaign goal", { exact: true })
      .fill("Introduce an evening ritual");
    await first.getByRole("button", { name: /Prepare rough cuts/ }).click();
    await first.locator(".pa-stage").waitFor();
    if (
      JSON.stringify(starts) !== JSON.stringify(["create", "preview-prepare"])
    )
      throw Error("First campaign started unexpected work");
    if (freshData.campaigns[0].reservedCredits !== 0)
      throw Error("First campaign reserved credits");
    await firstContext.close();
    const status = {
      checks,
      errors,
      blocked,
      paidGeneration: "not run",
      motion: "verified",
      catalogImage: "verified",
      approvalGates: "verified",
      firstCampaign:
        "verified with isolated responses; no extra campaign saved",
    };
    fs.writeFileSync(
      path.join(out, "preview-agent-checks.json"),
      JSON.stringify(status, null, 2),
    );
    console.log(JSON.stringify(status, null, 2));
    if (checks.some((c) => c.overflow) || errors.length || blocked.length)
      process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
