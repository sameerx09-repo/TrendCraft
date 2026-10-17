import {
  engagementExecution,
  assertSwayBeesMode,
} from "@/lib/engagement/swaybees-mode";
import { engagementPublishingStatus } from "@/lib/engagement/publishing-status";
import { engagementTestPlan } from "@/lib/engagement/test-plan";
import { NextResponse } from "next/server";
import {
  fetchRealPreview,
  SIMPLE_TYPE_MAP,
  splitEngagementTasks,
  type Scope,
  type Goal,
} from "@/lib/engagement/realPreview";
import { usdToInr } from "@/lib/engagement/fx";

const VALID_SCOPES: Scope[] = ["low", "medium", "high"];
const VALID_GOALS: Goal[] = ["reach", "engagement", "ugc"];
const MIN_VIABLE_INFLUENCERS = 3;

/**
 * Calls SwayBees' real GET /api/v1/tasks/preview live — no local rate card
 * anymore. Converts its USD figures back to ₹ for display (see
 * lib/engagement/fx.ts) and reshapes its {types, breakdown, totals} into
 * the Plan shape the wizard UI already renders.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const budget = Number(body.budget);
  const scope = body.scope as Scope;
  const goals = Array.isArray(body.goals) ? (body.goals as Goal[]) : [];

  if (!Number.isFinite(budget) || budget <= 0) {
    return NextResponse.json(
      { error: "budget must be a positive number" },
      { status: 400 },
    );
  }
  if (!VALID_SCOPES.includes(scope)) {
    return NextResponse.json(
      { error: `scope must be one of ${VALID_SCOPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (goals.length === 0 || !goals.every((g) => VALID_GOALS.includes(g))) {
    return NextResponse.json(
      {
        error: `goals must be a non-empty subset of ${VALID_GOALS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const publishing = engagementPublishingStatus();
  if (body.testMode !== publishing.mockMode)
    return NextResponse.json(
      {
        error:
          "The app mode changed. Return to video selection and review this campaign again.",
      },
      { status: 409 },
    );
  let execution;
  try {
    execution = engagementExecution(publishing.mockMode, body.testDelivery);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid delivery option.",
      },
      { status: 400 },
    );
  }
  if (!publishing.canProceed)
    return NextResponse.json({ error: publishing.error }, { status: 409 });
  if (!execution.provider)
    return NextResponse.json({
      plan: engagementTestPlan(budget, scope, goals),
      simulated: true,
      mode: "test",
    });
  try {
    const real = await fetchRealPreview(budget, scope, goals, execution.mode);
    assertSwayBeesMode(real.mode, execution.mode);
    const totalCost = usdToInr(real.totals.budgetUsedUsd);
    const plan = {
      scope,
      goals,
      influencerCount: real.totals.projectedInfluencers,
      totalCost,
      remainingBudget: budget - totalCost,
      viable: real.totals.projectedInfluencers >= MIN_VIABLE_INFLUENCERS,
      // "Engagement" is a blended bucket covering three real TaskTypes
      // (COMMENT, LIKE, TAG_FRIEND) — split its task count evenly across
      // them so the preview shows what submit will actually create.
      taskGroups: real.breakdown.flatMap<{
        type: "COMMENT" | "LIKE" | "TAG_FRIEND" | "UGC_VIDEO" | "SHARE";
        countTasks: number;
        payoutPerTask: number;
        totalCost: number;
        eligiblePoolSize: number;
      }>((b) =>
        b.type === "Engagement"
          ? splitEngagementTasks(b.projectedTasks, b.costPerTask).map((g) => ({
              type: g.type,
              countTasks: g.countTasks,
              payoutPerTask: usdToInr(g.payoutPerTask),
              totalCost: usdToInr(g.totalCost),
              eligiblePoolSize: b.eligiblePoolSize,
            }))
          : [
              {
                type: SIMPLE_TYPE_MAP[b.type],
                countTasks: b.projectedTasks,
                payoutPerTask: usdToInr(b.costPerTask),
                totalCost: usdToInr(b.budgetUsed),
                eligiblePoolSize: b.eligiblePoolSize,
              },
            ],
      ),
    };
    return NextResponse.json({ plan, mode: real.mode, simulated: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preview failed" },
      { status: 502 },
    );
  }
}
