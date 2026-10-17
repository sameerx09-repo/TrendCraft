"use client";
import {
  assertSwayBeesMode,
  type TestDelivery,
} from "@/lib/engagement/swaybees-mode";
import type { EngagementPublishingStatus } from "@/lib/engagement/media-types";
import { PageHeader } from "../PageHeader";
import {
  Megaphone,
  MessageCircle,
  Clapperboard,
  CircleCheck,
  ArrowRight,
  ArrowLeft,
  Rocket,
  Check,
  FileVideo,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";

import { useEffect, useState, useRef } from "react";
import MediaPicker, { type MediaSelection } from "./MediaPicker";
import {
  instagramPostUrl,
  mediaTargetIssue,
} from "@/lib/engagement/media-policy";

type Scope = "low" | "medium" | "high";
type Goal = "reach" | "engagement" | "ugc";

interface PlanTaskGroup {
  type: "SHARE" | "COMMENT" | "LIKE" | "TAG_FRIEND" | "UGC_VIDEO";
  countTasks: number;
  payoutPerTask: number;
  totalCost: number;
  eligiblePoolSize: number;
}

interface Plan {
  scope: Scope;
  goals: Goal[];
  influencerCount: number;
  taskGroups: PlanTaskGroup[];
  totalCost: number;
  remainingBudget: number;
  viable: boolean;
}

// "Scope" is SwayBees' real engagementRate tier now (buckets creators by
// their actual engagement %), not a follower-count minimum — SwayBees'
// public API has no follower filter to enforce one.
const SCOPE_INFO: Record<
  Scope,
  { label: string; rate: string; blurb: string }
> = {
  low: {
    label: "Low",
    rate: "0–2% engagement rate",
    blurb: "Cheapest, widest pool.",
  },
  medium: {
    label: "Medium",
    rate: "2–5% engagement rate",
    blurb: "Balanced cost and creator quality.",
  },
  high: {
    label: "High",
    rate: "5%+ engagement rate",
    blurb: "Priciest — most engaged creators.",
  },
};

const GOAL_INFO: Record<
  Goal,
  { label: string; sub: string; icon: typeof Megaphone }
> = {
  reach: { label: "Reach", sub: "Share to story", icon: Megaphone },
  engagement: {
    label: "Engagement",
    sub: "Comment / like / tag-a-friend on the reel",
    icon: MessageCircle,
  },
  ugc: {
    label: "UGC",
    sub: "Creators make their own video",
    icon: Clapperboard,
  },
};

const TASK_TYPE_LABEL: Record<PlanTaskGroup["type"], string> = {
  SHARE: "Share to story",
  COMMENT: "Comment on reel",
  LIKE: "Like reel",
  TAG_FRIEND: "Tag a friend",
  UGC_VIDEO: "UGC video",
};

const BUDGET_MIN = 500;
const BUDGET_MAX = 50_000;
const BUDGET_STEP = 100;

export default function DriveEngagementPage() {
  const [step, setStep] = useState(1);

  const [selection, setSelection] = useState<MediaSelection>({
    media: null,
    reelUrl: "",
    publicMediaAvailable: false,
  });
  const [publishing, setPublishing] =
    useState<EngagementPublishingStatus | null>(null);
  const publishingVersion = useRef(0);
  const mode = useRef<boolean | undefined>(undefined);
  const [savingSelection, setSavingSelection] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [approval, setApproval] = useState("");
  const reelUrl = selection.reelUrl;
  const [testDelivery, setTestDelivery] = useState<TestDelivery>("swaybees");
  const sendTestTasks = publishing?.mockMode && testDelivery === "swaybees";
  // Step 2 — budget / scope / goals
  const [budget, setBudget] = useState(1000);
  const [scope, setScope] = useState<Scope>("low");
  const [goals, setGoals] = useState<Goal[]>(["engagement"]);

  // Step 3 — live preview
  const [loadedPlan, setPlan] = useState<Plan | null>(null);
  const [planKey, setPlanKey] = useState("");
  const previewVersion = useRef(0);
  const previewKey = JSON.stringify([
    budget,
    scope,
    goals,
    publishing?.mockMode,
    publishing?.mockMode ? testDelivery : null,
  ]);
  const plan = planKey === previewKey ? loadedPlan : null;
  const campaignKey = JSON.stringify([
    previewKey,
    publishing?.mockMode,
    selection.media?.id,
    reelUrl,
    selection.media?.videoUrl,
  ]);
  const approved = approval === campaignKey;
  const targetIssue = publishing?.canProceed
    ? mediaTargetIssue({ ...selection, goals })
    : publishing?.error || "Checking Instagram connection...";
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Step 4 — submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    influencersEngaged: number;
    tasksCreated: number;
    eligiblePoolSize: number;
    simulated?: boolean;
    mode: "test" | "live";
    taskIds?: string[];
    partialFailure?: { type: string; status: number; error: string }[];
  } | null>(null);

  const toggleGoal = (g: Goal) => {
    setGoals((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  };

  async function fetchPreview() {
    if (goals.length === 0) {
      setPlan(null);
      return;
    }
    const version = ++previewVersion.current;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/engagement/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget,
          scope,
          goals,
          testMode: publishing?.mockMode,
          testDelivery: publishing?.mockMode ? testDelivery : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      assertSwayBeesMode(data.mode, publishing?.mockMode ? "test" : "live");
      if (version !== previewVersion.current) return;
      setPlan(data.plan);
      setPlanKey(previewKey);
    } catch (e) {
      if (version !== previewVersion.current) return;
      setPlan(null);
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      if (version === previewVersion.current) setLoadingPreview(false);
    }
  }

  useEffect(() => {
    async function refresh() {
      const version = ++publishingVersion.current;
      try {
        const response = await fetch("/api/engagement/publishing-status", {
          cache: "no-store",
        });
        const next: EngagementPublishingStatus = await response.json();
        if (!response.ok)
          throw new Error(
            "Instagram connection could not be checked. Please try again.",
          );
        if (version !== publishingVersion.current) return;
        if (mode.current !== undefined && mode.current !== next.mockMode) {
          previewVersion.current++;
          setStep(1);
          setPlan(null);
          setPlanKey("");
          setApproval("");
          setResult(null);
          setTestDelivery("swaybees");
          setLoadingPreview(false);
          setSourceError("");
        }
        mode.current = next.mockMode;
        setPublishing(next);
        setSelection((previous) => ({
          ...previous,
          reelUrl: previous.media
            ? next.mockMode
              ? next.testReelUrl || ""
              : previous.media.publishedUrl
            : next.mockMode
              ? previous.reelUrl
              : "",
        }));
      } catch (error) {
        if (version !== publishingVersion.current) return;
        setPublishing(null);
        setSourceError(
          error instanceof Error
            ? error.message
            : "Instagram connection could not be checked.",
        );
      }
    }
    const timer = setTimeout(() => void refresh(), 0);
    window.addEventListener("runtime-mode-changed", refresh);
    return () => {
      clearTimeout(timer);
      publishingVersion.current++;
      window.removeEventListener("runtime-mode-changed", refresh);
    };
  }, []);

  async function continueToPreview() {
    if (!canGoStep3) return;
    setApproval("");
    setStep(3);
    await fetchPreview();
  }
  async function submit() {
    if (!approved || submitting || targetIssue) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/engagement/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget,
          scope,
          goals,
          reelUrl,
          mediaId: selection.media?.id,
          expectedVideoUrl: selection.media?.videoUrl,
          reviewed: approved,
          testMode: publishing?.mockMode,
          testDelivery: publishing?.mockMode ? testDelivery : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Launch failed");
      assertSwayBeesMode(data.mode, publishing?.mockMode ? "test" : "live");
      if (
        sendTestTasks &&
        (data.simulated !== false ||
          !Array.isArray(data.taskIds) ||
          data.taskIds.length === 0)
      )
        throw new Error(
          "SwayBees did not confirm test task creation. Local simulation was not substituted. Check SwayBees before retrying.",
        );
      setResult(data);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setSubmitting(false);
    }
  }

  const canGoStep2 =
    !!(selection.media || instagramPostUrl(reelUrl)) &&
    (!reelUrl.trim() || !!instagramPostUrl(reelUrl));
  const canGoStep3 =
    budget >= BUDGET_MIN &&
    budget <= BUDGET_MAX &&
    goals.length > 0 &&
    !loadingPreview &&
    !targetIssue;

  async function continueToBudget() {
    if (!canGoStep2 || savingSelection) return;
    setSavingSelection(true);
    setSourceError("");
    try {
      const response = await fetch("/api/engagement/publishing-status", {
        cache: "no-store",
      });
      const next: EngagementPublishingStatus = await response.json();
      if (!response.ok)
        throw new Error(
          "Instagram connection could not be checked. Please try again.",
        );
      if (next.mockMode !== publishing?.mockMode) {
        window.dispatchEvent(new Event("runtime-mode-changed"));
        throw new Error(
          "The app mode changed. Review your video selection again.",
        );
      }
      setPublishing(next);
      if (!next.canProceed)
        throw new Error(
          next.error || "Cannot proceed: Instagram is not connected.",
        );
      if (next.mockMode && selection.media)
        setSelection((previous) => ({
          ...previous,
          reelUrl: next.testReelUrl || "",
        }));
      setStep(2);
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "This video could not be selected.",
      );
    } finally {
      setSavingSelection(false);
    }
  }
  function sourceSummary() {
    return (
      <div className="de-asset-summary">
        <FileVideo aria-hidden="true" />
        <div>
          <strong>
            {selection.media?.title || "Published Instagram reel"}
          </strong>
          <small>
            {selection.media?.label || "Instagram"}
            {selection.media?.reviewStatus === "pending"
              ? " / Review before launch"
              : ""}
          </small>
          {reelUrl && (
            <a
              href={instagramPostUrl(reelUrl) || undefined}
              target="_blank"
              rel="noreferrer"
            >
              {publishing?.mockMode
                ? "Test Instagram post"
                : "Published Instagram post"}
              <ArrowUpRight />
            </a>
          )}
        </div>
        <button
          className="btn btn-sm"
          onClick={() => {
            setResult(null);
            setApproval("");
            setSubmitError(null);
            setStep(1);
          }}
          disabled={submitting}
        >
          Change video
        </button>
      </div>
    );
  }
  return (
    <div className="page-wide de-workflow">
      <PageHeader
        title="Drive Engagement"
        subtitle="Creator campaigns / Powered by SwayBees"
      />

      <div className="de-steps">
        {["Video", "Budget & Scope", "Preview", "Launch"].map((label, i) => (
          <div
            key={label}
            className={`de-step ${step === i + 1 ? "active" : ""} ${step > i + 1 ? "done" : ""}`}
          >
            <span className="de-step-num">
              {step > i + 1 ? <Check size={13} aria-hidden="true" /> : i + 1}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="de-card">
          <div className="de-card-title">Which video are we promoting?</div>
          <MediaPicker
            value={selection}
            onChange={setSelection}
            publishing={publishing}
          />
          {sourceError && (
            <p className="de-media-error" role="alert">
              {sourceError}
            </p>
          )}
          <div className="de-actions">
            <div />
            <button
              className="btn btn-pri"
              disabled={!canGoStep2 || savingSelection || !publishing}
              onClick={() => void continueToBudget()}
            >
              {savingSelection ? (
                <LoaderCircle className="de-media-spin" />
              ) : null}
              {savingSelection ? "Checking Instagram..." : "Next"}
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="de-card">
          {sourceSummary()}
          {publishing?.mockMode && (
            <fieldset className="de-test-delivery">
              <legend>Test delivery</legend>
              {(
                [
                  ["swaybees", "SwayBees test tasks"],
                  ["local", "Local simulation"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="testDelivery"
                    value={value}
                    checked={testDelivery === value}
                    onChange={() => {
                      setTestDelivery(value);
                      setApproval("");
                      setPlan(null);
                      setPlanKey("");
                      setPreviewError(null);
                      previewVersion.current++;
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <div className="de-card-title">Budget</div>
          <div className="de-budget-row">
            <input
              aria-label="Campaign budget slider"
              type="range"
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={BUDGET_STEP}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="de-slider"
              style={{
                ["--pct" as string]: `${((budget - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100}%`,
              }}
            />
            <div className="de-budget-input">
              <span>₹</span>
              <input
                aria-label="Campaign budget"
                type="number"
                min={BUDGET_MIN}
                step={BUDGET_STEP}
                value={budget}
                onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
              />
            </div>
          </div>

          <div className="de-card-title" style={{ marginTop: 22 }}>
            Engagement scope
          </div>
          <div className="de-scope-row">
            {(Object.keys(SCOPE_INFO) as Scope[]).map((s) => (
              <button
                key={s}
                className={
                  scope === s ? "de-scope-card active" : "de-scope-card"
                }
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
              >
                <div className="de-scope-label">{SCOPE_INFO[s].label}</div>
                <div className="de-scope-followers">{SCOPE_INFO[s].rate}</div>
                <div className="de-scope-blurb">{SCOPE_INFO[s].blurb}</div>
              </button>
            ))}
          </div>

          <div className="de-card-title" style={{ marginTop: 22 }}>
            Goals
          </div>
          <div className="de-goal-row">
            {(Object.keys(GOAL_INFO) as Goal[]).map((g) => (
              <button
                key={g}
                className={
                  goals.includes(g) ? "de-goal-card active" : "de-goal-card"
                }
                aria-pressed={goals.includes(g)}
                onClick={() => toggleGoal(g)}
              >
                <span className="de-goal-icon">
                  {(() => {
                    const Icon = GOAL_INFO[g].icon;
                    return <Icon aria-hidden="true" />;
                  })()}
                </span>
                <div className="de-goal-label">{GOAL_INFO[g].label}</div>
                <div className="de-goal-sub">{GOAL_INFO[g].sub}</div>
              </button>
            ))}
          </div>

          <div className="de-actions">
            <button className="btn" onClick={() => setStep(1)}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
            <button
              className="btn btn-pri"
              disabled={!canGoStep3}
              onClick={() => void continueToPreview()}
            >
              {loadingPreview ? (
                "Calculating..."
              ) : (
                <>
                  Next <ArrowRight aria-hidden="true" />
                </>
              )}
            </button>
          </div>
          {targetIssue && (
            <div className="de-target-issue" role="alert">
              {targetIssue}
              <br />
              <button className="btn btn-sm" onClick={() => setStep(1)}>
                Review Instagram account
              </button>
            </div>
          )}
          {previewError && (
            <div
              className="modal-sub"
              style={{ color: "var(--fail)", marginTop: 10 }}
            >
              {previewError}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="de-card">
          <div className="de-card-title">Engagement Preview</div>
          {sourceSummary()}
          {loadingPreview && (
            <div className="modal-sub" role="status">
              Calculating...
            </div>
          )}
          {publishing?.mockMode && (
            <div className="de-test-notice" role="status">
              {sendTestTasks
                ? "SwayBees preview / Test mode"
                : "Test preview / Sample rates and creator counts"}
            </div>
          )}{" "}
          {plan && !plan.viable && (
            <div
              className="modal-sub"
              style={{ color: "var(--fail)", marginTop: 10 }}
            >
              ₹{budget.toLocaleString("en-IN")} at {SCOPE_INFO[scope].label}{" "}
              scope only covers {plan.influencerCount} creator
              {plan.influencerCount === 1 ? "" : "s"} — too few to run. Raise
              the budget, lower the scope, or pick fewer goals.
            </div>
          )}
          {previewError && (
            <div className="de-media-error" role="alert">
              {previewError}
            </div>
          )}
          {!loadingPreview && (!plan || !plan.viable) && (
            <button className="btn" onClick={() => void fetchPreview()}>
              Retry preview
            </button>
          )}
          {plan && !loadingPreview && (
            <>
              <div className="de-preview-hero">
                <div className="de-preview-stat">
                  <div className="de-preview-stat-num">
                    {plan.influencerCount}
                  </div>
                  <div className="de-preview-stat-label">
                    estimated creators
                  </div>
                </div>
                <div className="de-preview-stat">
                  <div className="de-preview-stat-num">
                    ₹{plan.totalCost.toLocaleString("en-IN")}
                  </div>
                  <div className="de-preview-stat-label">
                    of ₹{budget.toLocaleString("en-IN")} planned
                  </div>
                </div>
                <div className="de-preview-stat">
                  <div className="de-preview-stat-num">
                    {SCOPE_INFO[scope].rate}
                  </div>
                  <div className="de-preview-stat-label">
                    target tier ({SCOPE_INFO[scope].label})
                  </div>
                </div>
              </div>

              <table className="de-task-table">
                <thead>
                  <tr>
                    <th>Task type</th>
                    <th>Creators</th>
                    <th>Payout / creator</th>
                    <th>Eligible pool</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.taskGroups.map((g) => (
                    <tr key={g.type}>
                      <td>{TASK_TYPE_LABEL[g.type]}</td>
                      <td>{g.countTasks}</td>
                      <td>₹{g.payoutPerTask}</td>
                      <td>{g.eligiblePoolSize}</td>
                      <td>₹{g.totalCost.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.remainingBudget > 0 && (
                <div className="modal-sub" style={{ marginTop: 10 }}>
                  ₹{plan.remainingBudget.toLocaleString("en-IN")} left over (not
                  enough for one more full creator at this scope).
                </div>
              )}
              <div className="modal-sub" style={{ marginTop: 10 }}>
                {publishing?.mockMode ? (
                  sendTestTasks ? (
                    "SwayBees confirmed mode: test. Test tasks are created only after approval."
                  ) : (
                    "Sample estimate only. No real creators will be contacted."
                  )
                ) : (
                  <>
                    Live numbers from SwayBees&apos; real creator pool (rates
                    shown are a ₹83=$1 approx. — SwayBees bills in USD).
                    Launching runs its own independent match per task type, so
                    the exact creators invited can differ slightly from this
                    estimate.
                  </>
                )}
              </div>
            </>
          )}
          <div className="de-actions">
            <button className="btn" onClick={() => setStep(2)}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
            <button
              className="btn btn-pri"
              disabled={!plan?.viable || loadingPreview || !!targetIssue}
              onClick={() => setStep(4)}
            >
              Next <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="de-card">
          <div className="de-card-title">Launch</div>
          {sourceSummary()}
          {!result ? (
            <>
              {publishing?.mockMode && (
                <div
                  className="de-test-notice de-delivery-summary"
                  role="status"
                >
                  <strong>
                    Delivery:{" "}
                    {sendTestTasks
                      ? "SwayBees test tasks"
                      : "Local simulation (no SwayBees tasks)"}
                  </strong>
                  <button
                    className="btn btn-sm"
                    disabled={submitting}
                    onClick={() => {
                      setApproval("");
                      setStep(2);
                    }}
                  >
                    Change test delivery
                  </button>
                </div>
              )}
              <div className="modal-sub">
                {publishing?.mockMode ? (
                  sendTestTasks ? (
                    "This sends test-mode tasks to SwayBees. No Instagram post will be published."
                  ) : (
                    "Test launch only. No Instagram post, creator invitation or charge will be made."
                  )
                ) : (
                  <>
                    This creates {plan?.influencerCount} real task invitation
                    {plan?.influencerCount === 1 ? "" : "s"} per goal in
                    SwayBees, assigned to real creators matching this scope.
                    This cannot be undone from here.
                  </>
                )}
              </div>
              <label className="de-launch-check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) =>
                    setApproval(e.target.checked ? campaignKey : "")
                  }
                />
                {publishing?.mockMode
                  ? sendTestTasks
                    ? "I reviewed this test campaign and approve sending test-mode tasks to SwayBees."
                    : "I reviewed this test campaign and approve a simulated launch."
                  : "I reviewed this video, Instagram account and campaign budget, and approve publishing and contacting real creators."}
              </label>{" "}
              <div className="de-actions">
                <button
                  className="btn"
                  onClick={() => setStep(3)}
                  disabled={submitting}
                >
                  <ArrowLeft aria-hidden="true" /> Back
                </button>
                <button
                  className="btn btn-pri"
                  disabled={
                    submitting || !plan?.viable || !approved || !!targetIssue
                  }
                  onClick={submit}
                >
                  <Rocket aria-hidden="true" />
                  {submitting
                    ? "Launching..."
                    : publishing?.mockMode
                      ? sendTestTasks
                        ? "Send test tasks to SwayBees"
                        : "Run local simulation"
                      : "Launch campaign"}
                </button>
              </div>
              {submitError && (
                <div
                  className="modal-sub"
                  style={{ color: "var(--fail)", marginTop: 10 }}
                >
                  {submitError}
                </div>
              )}
            </>
          ) : (
            <div className="de-success">
              <CircleCheck aria-hidden="true" />
              <div className="de-card-title" style={{ marginTop: 8 }}>
                {result.simulated
                  ? "Local simulation complete"
                  : result.mode === "test"
                    ? "Test tasks sent to SwayBees"
                    : "Campaign live"}
              </div>
              <div className="modal-sub">
                {result.simulated ? (
                  "Simulation complete. No Instagram post, creator tasks or charges were created."
                ) : (
                  <>
                    {result.mode === "test" ? "Mode: test / " : ""}
                    {result.tasksCreated} task invitations sent to{" "}
                    {result.influencersEngaged} creators (from a pool of{" "}
                    {result.eligiblePoolSize} eligible).{" "}
                    {result.mode === "test"
                      ? "Test tasks are available in SwayBees Test mode."
                      : "Creators will see these in their SwayBees dashboard."}
                  </>
                )}{" "}
              </div>
              {result.simulated && publishing?.mockMode && (
                <div className="de-stats-action">
                  <button
                    className="btn btn-pri"
                    onClick={() => {
                      previewVersion.current++;
                      setTestDelivery("swaybees");
                      setResult(null);
                      setApproval("");
                      setPlan(null);
                      setPlanKey("");
                      setPreviewError(null);
                      setSubmitError(null);
                      setStep(2);
                    }}
                  >
                    <ArrowUpRight aria-hidden="true" />
                    Review &amp; send test tasks to SwayBees
                  </button>
                </div>
              )}
              {!result.simulated && (
                <div className="de-stats-action">
                  <a
                    className="btn btn-pri"
                    href="/api/engagement/swaybees-login"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {result.mode === "test"
                      ? "View test tasks on SwayBees"
                      : "View campaign stats on SwayBees"}
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </div>
              )}
              {result.partialFailure && (
                <div
                  className="modal-sub"
                  style={{ color: "var(--fail)", marginTop: 10 }}
                >
                  {result.partialFailure.length} task type
                  {result.partialFailure.length === 1 ? "" : "s"} failed and
                  were skipped:{" "}
                  {result.partialFailure
                    .map((f) => `${f.type} (${f.error})`)
                    .join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
