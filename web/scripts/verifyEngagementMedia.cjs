const {
  chromium,
} = require("C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const base = "http://localhost:3001",
  out = path.resolve(__dirname, "../output/playwright"),
  testUrl = "https://www.instagram.com/reel/TEST_ONLY_TRENDCRAFT/";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  });
  try {
    const context = await browser.newContext(),
      p = await context.newPage({ viewport: { width: 1440, height: 1050 } }),
      errors = [],
      calls = [],
      checks = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const actual = await (
      await context.request.get(base + "/api/engagement/media")
    ).json();
    const ai = actual.items.find((i) => i.label === "AI UGC");
    assert.ok(ai, "Real completed AI UGC required");
    const uploaded = {
      ...ai,
      id: "upload-existing",
      kind: "uploaded",
      title: "Owned brand UGC",
      label: "Brand UGC",
      publishedUrl: "",
    };
    const library = { ...actual, items: [...actual.items, uploaded] };
    let mockMode = true,
      connected = false,
      failUpload = false,
      failPreview = false,
      wrongTestResult = false;
    await context.route("**/api/**", async (r) => {
      const q = r.request(),
        url = new URL(q.url());
      if (url.pathname === "/api/engagement/publishing-status")
        return r.fulfill({
          json: {
            mockMode,
            instagramConnected: connected,
            canProceed: mockMode || connected,
            error:
              mockMode || connected
                ? null
                : "Cannot proceed: your brand's Instagram account is not connected. Instagram connection and publishing are not available in this build.",
            testReelUrl: mockMode ? testUrl : null,
          },
        });
      if (url.pathname === "/api/engagement/media") {
        assert.equal(
          q.method(),
          "GET",
          "Test URLs must never be saved as real published posts",
        );
        return r.fulfill({ json: library });
      }
      if (url.pathname === "/api/engagement/media/upload") {
        const form = await new Request(url, {
          method: "POST",
          headers: q.headers(),
          body: q.postDataBuffer(),
        }).formData();
        calls.push({
          action: "upload",
          title: form.get("title"),
          rights: form.get("rights"),
          type: form.get("videoType"),
        });
        if (failUpload)
          return r.fulfill({
            status: 400,
            json: { error: "This video could not be processed." },
          });
        await new Promise((resolve) => setTimeout(resolve, 700));
        const item = {
          ...uploaded,
          id: "upload-new",
          title: form.get("title"),
        };
        library.items.unshift(item);
        return r.fulfill({ status: 201, json: { item } });
      }
      if (url.pathname === "/api/engagement/preview") {
        const body = q.postDataJSON();
        calls.push({ action: "preview", ...body });
        if (failPreview)
          return r.fulfill({
            status: 502,
            json: { error: "Sample preview unavailable. Try again." },
          });
        return r.fulfill({
          json: {
            simulated: mockMode && body.testDelivery !== "swaybees",
            mode: mockMode ? "test" : "live",
            plan: {
              scope: body.scope,
              goals: body.goals,
              influencerCount: 6,
              totalCost: 900,
              remainingBudget: body.budget - 900,
              viable: true,
              taskGroups: body.goals.map((goal) => ({
                type:
                  goal === "ugc"
                    ? "UGC_VIDEO"
                    : goal === "reach"
                      ? "SHARE"
                      : "COMMENT",
                countTasks: 6,
                payoutPerTask: 150,
                totalCost: 900,
                eligiblePoolSize: 20,
              })),
            },
          },
        });
      }
      if (url.pathname === "/api/engagement/submit") {
        const body = q.postDataJSON();
        calls.push({ action: "submit", ...body });
        return r.fulfill({
          json: {
            simulated:
              mockMode && (body.testDelivery !== "swaybees" || wrongTestResult),
            mode: mockMode ? "test" : "live",
            influencersEngaged: 6,
            tasksCreated: 6,
            taskIds:
              mockMode && body.testDelivery !== "swaybees"
                ? []
                : ["test-task-fixture"],
            eligiblePoolSize: 20,
          },
        });
      }
      if (!["GET", "HEAD"].includes(q.method()))
        throw Error("Unexpected live mutation " + url.pathname);
      return r.continue();
    });
    const next = () =>
        p.getByRole("button", { name: "Next", exact: true }).click(),
      back = () => p.getByRole("button", { name: "Back", exact: true }).click();
    const previews = () => calls.filter((c) => c.action === "preview").length;
    async function go(query = "") {
      await p.goto(base + "/drive-engagement" + query);
      await p.waitForSelector(".de-video-card");
      await p
        .getByRole("status")
        .filter({
          hasText: mockMode
            ? "Test mode /"
            : connected
              ? "Connected"
              : "Not connected",
        })
        .waitFor();
    }
    async function selectAI() {
      await p
        .getByLabel("Video type filter", { exact: true })
        .selectOption("AI UGC");
      await p.locator(".de-video-card").first().click();
    }
    async function shot(name) {
      await p.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: true,
      });
    }
    await go();
    await selectAI();
    assert.equal(
      await p.getByLabel("Instagram reel URL", { exact: true }).inputValue(),
      testUrl,
    );
    await p
      .getByRole("button", { name: "Unselect video", exact: true })
      .click();
    assert.equal(await p.locator(".de-selected-video").count(), 0);
    assert.equal(
      await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
      false,
    );
    assert.equal(
      await p.getByLabel("Instagram reel URL", { exact: true }).inputValue(),
      "",
    );
    await p.locator(".de-video-card").first().click();
    await p.locator(".de-video-card").first().click();
    assert.equal(await p.locator(".de-selected-video").count(), 0);
    await p.locator(".de-video-card").first().click();
    await p
      .getByRole("button", { name: "Refresh videos", exact: true })
      .click();
    await p.locator(".de-video-card.selected").waitFor();
    await p.waitForFunction(
      () => document.querySelector(".de-selected-video")?.readyState >= 2,
    );
    await shot("engagement-corrected-video-desktop");
    assert.equal(previews(), 0);
    await next();
    await p.getByLabel("Campaign budget", { exact: true }).waitFor();
    assert.equal(
      await p
        .getByRole("radio", { name: "SwayBees test tasks", exact: true })
        .isChecked(),
      true,
      "Test mode must default to SwayBees delivery",
    );
    await p
      .getByRole("radio", { name: "Local simulation", exact: true })
      .check();
    await p.waitForTimeout(500);
    assert.equal(previews(), 0, "No calculation upon entering Budget");
    assert.equal(
      await p.getByText("Calculating...", { exact: true }).count(),
      0,
    );
    await p.getByLabel("Campaign budget", { exact: true }).fill("1500");
    await p.getByRole("button", { name: /^Medium/ }).click();
    await p.waitForTimeout(400);
    assert.equal(
      previews(),
      0,
      "Budget changes must not calculate automatically",
    );
    await shot("engagement-corrected-budget-desktop");
    await next();
    await p
      .getByText("Test preview / Sample rates and creator counts", {
        exact: true,
      })
      .waitFor();
    await p.locator(".de-task-table").waitFor();
    assert.equal(previews(), 1);
    await next();
    const launch = p.getByRole("button", {
      name: "Run local simulation",
      exact: true,
    });
    assert.equal(await launch.isEnabled(), false);
    await p.locator(".de-launch-check input").check();
    await back();
    await back();
    await p.getByLabel("Campaign budget", { exact: true }).fill("1700");
    assert.equal(previews(), 1);
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    assert.equal(await p.locator(".de-launch-check input").isChecked(), false);
    await p.locator(".de-launch-check input").check();
    await launch.click();
    await p.getByText("Local simulation complete", { exact: true }).waitFor();
    assert.equal(
      await p
        .getByRole("link", { name: "View campaign stats on SwayBees" })
        .count(),
      0,
    );
    const submission = calls.find((c) => c.action === "submit");
    assert.equal(submission.testMode, true);
    assert.equal(submission.mediaId, ai.id);
    assert.equal(submission.expectedVideoUrl, ai.videoUrl);
    assert.equal(submission.reelUrl, testUrl);
    await shot("engagement-test-complete-desktop");
    const beforeRecoveryPreviews = previews(),
      beforeRecoverySubmits = calls.filter((c) => c.action === "submit").length;
    await p
      .getByRole("button", {
        name: "Review & send test tasks to SwayBees",
        exact: true,
      })
      .click();
    assert.equal(
      await p
        .getByRole("radio", { name: "SwayBees test tasks", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(previews(), beforeRecoveryPreviews);
    assert.equal(
      calls.filter((c) => c.action === "submit").length,
      beforeRecoverySubmits,
    );
    await p.getByRole("button", { name: "Change video", exact: true }).click();
    await p.locator(".de-selected-video").waitFor();
    await next();
    assert.equal(
      await p
        .getByRole("radio", { name: "SwayBees test tasks", exact: true })
        .isChecked(),
      true,
      "Changing video must preserve provider delivery",
    );
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    assert.equal(await p.locator(".de-launch-check input").isChecked(), false);
    assert.equal(
      await p
        .getByRole("button", {
          name: "Send test tasks to SwayBees",
          exact: true,
        })
        .isEnabled(),
      false,
    );
    await p
      .getByRole("status")
      .filter({ hasText: "Delivery: SwayBees test tasks" })
      .waitFor();
    await p
      .getByRole("button", { name: "Change test delivery", exact: true })
      .click();
    await p
      .getByRole("radio", { name: "Local simulation", exact: true })
      .check();
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    await p
      .getByRole("status")
      .filter({ hasText: "Local simulation (no SwayBees tasks)" })
      .waitFor();
    // Provider test delivery is explicit and invalidates previous local approval.
    await go();
    await selectAI();
    await next();
    assert.equal(
      await p
        .getByRole("radio", { name: "SwayBees test tasks", exact: true })
        .isChecked(),
      true,
    );
    const beforeDelivery = previews();
    await p
      .getByRole("radio", { name: "SwayBees test tasks", exact: true })
      .check();
    assert.equal(previews(), beforeDelivery);
    await shot("engagement-swaybees-test-choice-desktop");
    await p.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await shot("engagement-swaybees-test-choice-mobile");
    await p.setViewportSize({ width: 1440, height: 1050 });
    await next();
    await p
      .getByText("SwayBees preview / Test mode", { exact: true })
      .waitFor();
    await p.locator(".de-task-table").waitFor();
    await next();
    const sendTest = p.getByRole("button", {
      name: "Send test tasks to SwayBees",
      exact: true,
    });
    assert.equal(await sendTest.isEnabled(), false);
    await p.locator(".de-launch-check input").check();
    await back();
    await back();
    await p
      .getByRole("radio", { name: "Local simulation", exact: true })
      .check();
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    assert.equal(await p.locator(".de-launch-check input").isChecked(), false);
    assert.equal(
      await p
        .getByRole("button", { name: "Run local simulation", exact: true })
        .isEnabled(),
      false,
    );
    await back();
    await back();
    await p
      .getByRole("radio", { name: "SwayBees test tasks", exact: true })
      .check();
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    await p.locator(".de-launch-check input").check();
    wrongTestResult = true;
    await sendTest.click();
    await p
      .getByText(
        "SwayBees did not confirm test task creation. Local simulation was not substituted. Check SwayBees before retrying.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await p.getByText("Local simulation complete", { exact: true }).count(),
      0,
    );
    const failuresSent = calls.filter((c) => c.action === "submit").length;
    await p.waitForTimeout(500);
    assert.equal(
      calls.filter((c) => c.action === "submit").length,
      failuresSent,
    );
    wrongTestResult = false;
    await sendTest.click();
    await p.getByText("Test tasks sent to SwayBees", { exact: true }).waitFor();
    await p
      .getByRole("link", { name: "View test tasks on SwayBees", exact: true })
      .waitFor();
    const providerSubmit = calls.filter((c) => c.action === "submit").at(-1);
    assert.equal(providerSubmit.testMode, true);
    assert.equal(providerSubmit.testDelivery, "swaybees");
    await shot("engagement-swaybees-test-success-desktop");
    await go("?postId=" + ai.id.slice(5));
    await p.locator(".de-selected-video").waitFor();
    assert.equal(
      await p.getByLabel("Instagram reel URL", { exact: true }).inputValue(),
      testUrl,
    );
    // Switching modes must return to the video gate and discard test URLs and approvals.
    await next();
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    await p.locator(".de-launch-check input").check();
    mockMode = false;
    await p.evaluate(() =>
      window.dispatchEvent(new Event("runtime-mode-changed")),
    );
    await p
      .getByText("Which video are we promoting?", { exact: true })
      .waitFor();
    await p.getByRole("status").filter({ hasText: "Not connected" }).waitFor();
    assert.equal(
      await p.getByLabel("Instagram reel URL", { exact: true }).count(),
      0,
    );
    const beforeLive = previews();
    await next();
    await p
      .getByRole("alert")
      .filter({ hasText: "Instagram account is not connected" })
      .waitFor();
    assert.equal(previews(), beforeLive);
    assert.equal(
      await p.getByLabel("Campaign budget", { exact: true }).count(),
      0,
    );
    await shot("engagement-instagram-disconnected-desktop");
    await p.setViewportSize({ width: 390, height: 844 });
    await shot("engagement-instagram-disconnected-mobile");
    mockMode = true;
    await p.evaluate(() =>
      window.dispatchEvent(new Event("runtime-mode-changed")),
    );
    await p.getByRole("status").filter({ hasText: "Test mode /" }).waitFor();
    await p.setViewportSize({ width: 1440, height: 1050 });
    // Preview failures are visible and retryable, without allowing launch.
    await go();
    await selectAI();
    await next();
    failPreview = true;
    await next();
    await p
      .getByRole("alert")
      .filter({ hasText: "Sample preview unavailable" })
      .waitFor();
    assert.equal(
      await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
      false,
    );
    failPreview = false;
    await p.getByRole("button", { name: "Retry preview", exact: true }).click();
    await p.locator(".de-task-table").waitFor();
    // Uploaded media remains separate from pending local files, and can be cleared.
    await go();
    await p
      .getByRole("button", { name: "Upload your video", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Choose Owned brand UGC", exact: true })
      .click();
    await p
      .getByLabel("Video file", { exact: true })
      .setInputFiles(path.join(out, "brand-feed-render-check.mp4"));
    assert.equal(
      await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
      false,
    );
    await p
      .getByRole("button", { name: "Choose Owned brand UGC", exact: true })
      .click();
    assert.equal(
      await p.locator(".de-selected-video").getAttribute("src"),
      uploaded.videoUrl,
    );
    assert.equal(
      await p
        .getByLabel("Video file", { exact: true })
        .evaluate((el) => el.files.length),
      0,
    );
    await p
      .getByLabel("Video file", { exact: true })
      .setInputFiles(path.join(out, "brand-feed-render-check.mp4"));
    await p
      .getByLabel("Video title", { exact: true })
      .fill("Brand-owned creator UGC");
    await p.getByLabel("Video type", { exact: true }).selectOption("ugc");
    await p
      .getByLabel(
        "I have permission to use this video in a creator campaign.",
        { exact: true },
      )
      .check();
    await p.getByRole("button", { name: "Upload video", exact: true }).click();
    assert.equal(
      await p
        .getByRole("button", { name: "Created videos", exact: true })
        .isEnabled(),
      false,
    );
    await p
      .getByRole("heading", { name: "Brand-owned creator UGC", exact: true })
      .waitFor();
    assert.equal(
      await p.getByLabel("Instagram reel URL", { exact: true }).inputValue(),
      testUrl,
    );
    await p
      .getByRole("button", { name: "Unselect video", exact: true })
      .click();
    assert.equal(
      await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
      false,
    );
    await p.reload();
    await p.waitForSelector(".de-video-card");
    await p
      .getByRole("button", { name: "Upload your video", exact: true })
      .click();
    await p
      .getByRole("button", {
        name: "Choose Brand-owned creator UGC",
        exact: true,
      })
      .waitFor();
    failUpload = true;
    await p
      .getByLabel("Video file", { exact: true })
      .setInputFiles(path.join(out, "brand-feed-render-check.mp4"));
    await p.getByLabel("Video title", { exact: true }).fill("Failed upload");
    await p
      .getByLabel(
        "I have permission to use this video in a creator campaign.",
        { exact: true },
      )
      .check();
    await p.getByRole("button", { name: "Upload video", exact: true }).click();
    await p
      .getByRole("alert")
      .filter({ hasText: "could not be processed" })
      .waitFor();
    assert.equal(
      await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
      false,
    );
    for (const width of [1440, 1024, 768, 390, 320]) {
      await p.setViewportSize({ width, height: 1000 });
      await go();
      for (const source of [
        "Created videos",
        "Upload your video",
        "Paste any reel link",
      ]) {
        await p.getByRole("button", { name: source, exact: true }).click();
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          "Overflow " + width + " " + source,
        );
        checks.push({ width, source });
      }
      assert.equal(
        await p.getByLabel("Instagram reel URL", { exact: true }).inputValue(),
        testUrl,
      );
      await p
        .getByLabel("Instagram reel URL", { exact: true })
        .fill("https://instagram.com.evil.example/reel/x");
      assert.equal(
        await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
        false,
      );
      await p
        .getByRole("button", { name: "Use test Instagram URL", exact: true })
        .click();
      assert.equal(
        await p.getByRole("button", { name: "Next", exact: true }).isEnabled(),
        true,
      );
      await next();
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        "Budget overflow " + width,
      );
      checks.push({ width, step: "budget" });
      if (width === 390) await shot("engagement-corrected-budget-mobile");
      await next();
      await p.locator(".de-task-table").waitFor();
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        "Preview overflow " + width,
      );
      assert.equal(
        await p.evaluate(() => {
          const main = document
            .querySelector(".de-workflow")
            .getBoundingClientRect();
          return [
            ...document.querySelectorAll(
              ".de-preview-stat,.de-preview-stat-num,.de-task-table th",
            ),
          ].some((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.right > main.right + 1 ||
              r.left < main.left - 1 ||
              el.scrollWidth > el.clientWidth + 1
            );
          });
        }),
        false,
        "Clipped preview content " + width,
      );
      checks.push({ width, step: "preview" });
      if (width === 390) await shot("engagement-corrected-preview-mobile");
    }
    // Preserve the existing real-success handoff without contacting any creator.
    mockMode = false;
    connected = true;
    await go();
    await p
      .getByRole("button", { name: "Paste any reel link", exact: true })
      .click();
    await p
      .getByLabel("Instagram reel URL", { exact: true })
      .fill("https://www.instagram.com/reel/brand-post/");
    await next();
    await next();
    await p.locator(".de-task-table").waitFor();
    await next();
    await p.locator(".de-launch-check input").check();
    await p
      .getByRole("button", { name: "Launch campaign", exact: true })
      .click();
    await p.getByText("Campaign live", { exact: true }).waitFor();
    const stats = p.getByRole("link", {
      name: "View campaign stats on SwayBees",
    });
    await stats.waitFor();
    assert.equal(await stats.getAttribute("target"), "_blank");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "engagement-media-ui-checks.json"),
      JSON.stringify(
        {
          checks,
          errors,
          actions: calls.map((c) => c.action),
          realCreatorTasks: 0,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: " +
        checks.length +
        " responsive checks; deselection, explicit calculation, Instagram gate, safe test URL/simulation, mode invalidation, upload states, failures and SwayBees handoff. All creator launches intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
