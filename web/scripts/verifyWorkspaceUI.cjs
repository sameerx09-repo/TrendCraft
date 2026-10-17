const {
  chromium,
} = require("C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("fs"),
  path = require("path"),
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
      blocked = [],
      checks = [];
    page.on("pageerror", (e) =>
      errors.push({ url: page.url(), message: e.message }),
    );
    await context.route("**/api/**", (r) => {
      const q = r.request();
      if (
        !["GET", "HEAD"].includes(q.method()) &&
        !q.url().endsWith("/api/engagement/preview")
      ) {
        blocked.push(q.url());
        return r.abort();
      }
      return r.continue();
    });
    async function check(route, width) {
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        background: getComputedStyle(document.body).backgroundColor,
        accent: getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
        title: document.querySelector("h1")?.textContent,
        sidebar: getComputedStyle(document.querySelector(".sidebar"))
          .backgroundColor,
        spills: [...document.querySelectorAll("main *")]
          .filter(
            (n) =>
              n.getClientRects().length &&
              n.getBoundingClientRect().right > innerWidth + 3,
          )
          .slice(0, 5)
          .map((n) => n.tagName + "." + n.className),
      }));
      checks.push({ route, width, ...state });
      if ([1280, 390].includes(width))
        await page.screenshot({
          path: path.join(
            out,
            "workspace-" + route.replaceAll("/", "-") + "-" + width + ".png",
          ),
        });
    }
    for (const width of [1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of [
        "/workspace",
        "/creatives",
        "/viral-trends",
        "/personas",
        "/exports",
        "/drive-engagement",
        "/brand",
      ]) {
        await page.goto("http://localhost:3001" + route);
        await page.waitForSelector(
          route === "/workspace" ? ".mc-engine-grid" : ".workspace-page-head",
        );
        if (route === "/creatives")
          await page.waitForFunction(() =>
            document.querySelector(".rmx-card,.empty-state"),
          );
        if (route === "/exports")
          await page.waitForFunction(() =>
            document.querySelector(".export-card,.empty-state"),
          );
        if (route === "/brand") await page.waitForSelector(".brand-grid");
        if (route === "/viral-trends")
          await page.waitForFunction(() =>
            document.querySelector(".cl-card,.empty-state"),
          );
        await page.waitForTimeout(250);
        await check(route, width);
        if (route === "/personas") {
          const href = await page
            .locator(".persona-tile-grid a")
            .first()
            .getAttribute("href");
          await page.goto("http://localhost:3001" + href);
          await page.waitForSelector(".persona-clip-card");
          await check(href, width);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("http://localhost:3001/creatives");
    await page.getByRole("button", { name: "Generate Product UGC" }).click();
    await page.locator(".remix-picker-modal").waitFor();
    await check("product-dialog", 390);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto("http://localhost:3001/viral-trends");
    await page
      .getByRole("button", { name: "Import reels", exact: true })
      .click();
    await page.locator(".remix-picker-modal,.modal").waitFor();
    await check("import-dialog", 390);
    await page.goto("http://localhost:3001/drive-engagement");
    await page
      .getByRole("button", { name: "Paste any reel link", exact: true })
      .click();
    await page
      .getByPlaceholder("https://www.instagram.com/reel/...")
      .fill("https://www.instagram.com/reel/preview-only/");
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByText("Engagement scope", { exact: true }).waitFor();
    await check("engagement-budget", 390);
    await page.getByRole("button", {name:"Open navigation",exact:true}).click();
    await page.locator(".sidebar.is-open").waitFor();
    await page.getByRole("link", {name:"Brand Profile",exact:true}).waitFor({state:"visible"});
    await check("mobile-navigation",390);
    await page.getByRole("link", {name:"Persona Library",exact:true}).click();
    await page.getByRole("button", {name:"Ready to use",exact:true}).click();
    if(await page.locator(".persona-tile").count()!==3)throw Error("Ready persona filter failed");
    await page.goto("http://localhost:3001/exports");
    await page.locator(".export-play").first().click();
    await page.locator(".export-media video").waitFor();
    await page.locator(".export-media video").evaluate(v=>v.pause());
    await page.goto("http://localhost:3001/creatives");
    await page.getByRole("button",{name:"Generate AI UGC",exact:false}).first().click();
    await page.locator(".ugc-persona-grid img").first().waitFor();
    await check("persona-dialog",390);
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await page.locator(".rmx-card").nth(1).click();
    await page.locator(".rmx-detail").waitFor();
    await check("creative-detail",390);
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await page.goto("http://localhost:3001/workspace");
    await page.locator(".mc-engine-grid").waitFor();
    for(const width of [1280,768,390,320]){
      await page.setViewportSize({width,height:1000});
      for(const tab of ["Overview","Brief","Remix","AI UGC","Product UGC","Review","Activity","Exports"]){
        await page.getByRole("tab",{name:tab,exact:true}).click();
        await check("campaign-"+tab.replaceAll(" ","-"),width);
      }
    }
    fs.writeFileSync(
      path.join(out, "workspace-ui-checks.json"),
      JSON.stringify({ checks, errors, blocked }, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          screens: checks.length,
          failures: checks.filter((c) => c.overflow || c.spills.length),
          errors,
          blocked,
        },
        null,
        2,
      ),
    );
    if (checks.some((c) => c.overflow) || errors.length || blocked.length)
      process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});



