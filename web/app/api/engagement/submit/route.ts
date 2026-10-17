import {
  engagementExecution,
  assertSwayBeesMode,
} from "@/lib/engagement/swaybees-mode";
import { engagementPublishingStatus } from "@/lib/engagement/publishing-status";
import { engagementTestPlan } from "@/lib/engagement/test-plan";
import { isTestInstagramUrl } from "@/lib/engagement/media-policy";
import { NextResponse } from "next/server";
import { getOrCreateCurrentBrand } from "@/lib/db/getOrCreateBrand";
import { campaignMediaTarget } from "@/lib/engagement/media-library";
import {
  fetchRealPreview,
  SIMPLE_TYPE_MAP,
  splitEngagementTasks,
  type Scope,
  type Goal,
} from "@/lib/engagement/realPreview";

type RealTaskTypeCreated =
  | "UGC_VIDEO"
  | "COMMENT"
  | "LIKE"
  | "TAG_FRIEND"
  | "SHARE";

const VALID_SCOPES: Scope[] = ["low", "medium", "high"];
const VALID_GOALS: Goal[] = ["reach", "engagement", "ugc"];
const MIN_VIABLE_INFLUENCERS = 3;

/**
 * Real seed data is 100% US-based influencers (confirmed live against
 * SwayBees' DB, 2026-10-04 — zero India-based rows exist yet). Indian
 * cities here would make SwayBees' matching return an empty pool every
 * time, so this targets the real city list that actually exists until
 * real India coverage is added.
 */
const AVAILABLE_LOCATIONS = [
  "Los Angeles",
  "Chicago",
  "New York",
  "Portland",
  "San Francisco",
  "Dallas",
  "Philadelphia",
  "Boston",
  "San Antonio",
  "Phoenix",
  "Austin",
  "Denver",
  "Miami",
  "Atlanta",
  "Charlotte",
  "Seattle",
  "Minneapolis",
  "Houston",
  "San Diego",
].join(", ");

function resolveNiche(category: string | undefined): string {
  const map: Record<string, string> = {
    skincare: "Skincare",
    beauty: "Beauty",
    wellness: "Wellness",
    fitness: "Fitness",
    fashion: "Fashion",
    makeup: "Makeup",
    haircare: "Haircare",
  };
  const key = (category ?? "").toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k)) return v;
  }
  return "Beauty";
}

function brandTag(companyName: string): string {
  return `@${companyName.toLowerCase().replace(/\s+/g, "")}`;
}

function taskCopy(
  taskType: RealTaskTypeCreated,
  companyName: string,
  reelUrl: string,
  referenceUrl: string,
): {
  description: string;
  verificationTag: string | null;
  targetPostUrl: string | null;
} {
  const tag = brandTag(companyName);
  switch (taskType) {
    case "UGC_VIDEO":
      return {
        description: `Create a UGC video inspired by ${companyName}'s reel. Tag ${tag} in your caption. Reference video: ${referenceUrl}`,
        verificationTag: tag,
        targetPostUrl: null,
      };
    case "COMMENT":
      return {
        description: `Comment on ${companyName}'s reel: ${reelUrl}`,
        verificationTag: null,
        targetPostUrl: reelUrl,
      };
    case "LIKE":
      return {
        description: `Like ${companyName}'s reel: ${reelUrl}`,
        verificationTag: null,
        targetPostUrl: reelUrl,
      };
    case "TAG_FRIEND":
      return {
        description: `Tag a friend in the comments of ${companyName}'s reel: ${reelUrl}`,
        verificationTag: null,
        targetPostUrl: reelUrl,
      };
    case "SHARE":
      return {
        description: `Share ${companyName}'s reel to your story: ${reelUrl}`,
        verificationTag: null,
        targetPostUrl: reelUrl,
      };
  }
}

interface RealApiSuccess {
  mode: "test" | "live";
  taskId: string;
  invitationsCreated: number;
  eligiblePoolSize: number;
  creators: { id: string; handle: string; followerCount: number }[];
}

/**
 * Creates the real campaign: first calls the same real GET
 * /api/v1/tasks/preview the preview panel uses (so submission can never
 * promise numbers the live preview didn't just confirm), then issues one
 * real POST /api/v1/tasks per concrete TaskType with a nonzero task count,
 * using that preview call's own costPerTask/budgetUsed so the two can't
 * drift. "Engagement" is a blended bucket covering three real TaskTypes
 * (COMMENT, LIKE, TAG_FRIEND) — splitEngagementTasks divides its task
 * count evenly across them (same split the preview panel shows), so each
 * becomes its own real POST call rather than only ever creating COMMENT.
 *
 * Known real limitations (confirmed live, 2026-10-04):
 *  1. The preview's pool is filtered by engagementRate tier; the actual
 *     matching behind POST /api/v1/tasks (findEligibleInfluencers +
 *     selectDiversified) has no engagementRate filter at all — it only
 *     hard-filters on gender/age/location/niche, then ranks by score. So
 *     the creators actually invited may not be the same engagementRate
 *     tier the preview counted.
 *  2. Each TaskType call (including each of the three Engagement
 *     sub-types) runs its own independent matching pass with no way to
 *     pin a specific creator list, so the same creator isn't guaranteed
 *     to receive every selected goal's task — splitting Engagement into
 *     three calls means a given creator likely gets only ONE of
 *     comment/like/tag-friend, not all three.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const budget = Number(body.budget);
  const scope = body.scope as Scope;
  const goals = Array.isArray(body.goals) ? (body.goals as Goal[]) : [];
  const reelUrl = String(body.reelUrl ?? "").trim();

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
  if (!reelUrl && !body.mediaId) {
    return NextResponse.json(
      { error: "Choose a video or a published Instagram link." },
      { status: 400 },
    );
  }

  if (body.reviewed !== true)
    return NextResponse.json(
      {
        error:
          "Review the selected video, destination and budget before launching.",
      },
      { status: 400 },
    );
  if (new Set(goals).size !== goals.length)
    return NextResponse.json(
      { error: "Choose each goal only once." },
      { status: 400 },
    );
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
  if (!publishing.mockMode && isTestInstagramUrl(reelUrl))
    return NextResponse.json(
      { error: "Test Instagram links cannot be used in live campaigns." },
      { status: 400 },
    );
  let brand, target;
  try {
    brand = await getOrCreateCurrentBrand();
    target = await campaignMediaTarget(brand.id, {
      mediaId: typeof body.mediaId === "string" ? body.mediaId : undefined,
      expectedVideoUrl:
        typeof body.expectedVideoUrl === "string"
          ? body.expectedVideoUrl
          : undefined,
      reelUrl,
      goals,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Choose a valid video and destination.",
      },
      { status: 400 },
    );
  }
  if (!execution.provider) {
    const plan = engagementTestPlan(budget, scope, goals);
    if (!plan.viable)
      return NextResponse.json(
        {
          error:
            "The sample budget covers too few creators. Increase budget or lower scope.",
        },
        { status: 400 },
      );
    return NextResponse.json({
      simulated: true,
      mode: "test",
      influencersEngaged: plan.influencerCount,
      tasksCreated: plan.taskGroups.reduce((sum, g) => sum + g.countTasks, 0),
      eligiblePoolSize: 30,
      taskIds: [],
    });
  }
  let preview;
  try {
    preview = await fetchRealPreview(budget, scope, goals, execution.mode);
    assertSwayBeesMode(preview.mode, execution.mode);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preview failed" },
      { status: 502 },
    );
  }
  if (preview.totals.projectedInfluencers < MIN_VIABLE_INFLUENCERS) {
    return NextResponse.json(
      {
        error: `This budget/scope only covers ${preview.totals.projectedInfluencers} influencer(s) — too few to run. Increase budget or lower scope.`,
      },
      { status: 400 },
    );
  }

  const base = process.env.SWAYBEES_API_URL;
  const apiKey = process.env.SWAYBEES_API_KEY;
  if (!base || !apiKey) {
    return NextResponse.json(
      { error: "SwayBees integration not configured" },
      { status: 500 },
    );
  }

  const companyName = brand.name;
  const brandEmail = `${companyName.toLowerCase().replace(/\s+/g, "-")}@trendcraft.integration`;
  const niche = resolveNiche(brand.identity || "skincare");

  const calls: {
    taskType: RealTaskTypeCreated;
    countTasks: number;
    payoutPerTask: number;
    totalCost: number;
  }[] = [];
  for (const b of preview.breakdown) {
    if (b.type === "Engagement") {
      calls.push(
        ...splitEngagementTasks(b.projectedTasks, b.costPerTask).map((g) => ({
          taskType: g.type,
          countTasks: g.countTasks,
          payoutPerTask: g.payoutPerTask,
          totalCost: g.totalCost,
        })),
      );
    } else {
      calls.push({
        taskType: SIMPLE_TYPE_MAP[b.type],
        countTasks: b.projectedTasks,
        payoutPerTask: b.costPerTask,
        totalCost: b.budgetUsed,
      });
    }
  }

  const successes: RealApiSuccess[] = [];
  const failures: {
    type: RealTaskTypeCreated;
    status: number;
    error: string;
  }[] = [];

  for (const c of calls) {
    if (c.countTasks <= 0) continue;
    const copy = taskCopy(
      c.taskType,
      companyName,
      target.publishedUrl,
      target.referenceUrl,
    );
    const payload = {
      mode: execution.mode,
      brandEmail,
      type: c.taskType,
      platform: "INSTAGRAM",
      description: copy.description,
      payoutAmount: c.payoutPerTask,
      maxBudget: c.totalCost,
      targetPostUrl: copy.targetPostUrl ?? undefined,
      verificationTag: copy.verificationTag ?? undefined,
      criteria: {
        gender: "any",
        ageMin: 18,
        ageMax: 65,
        location: AVAILABLE_LOCATIONS,
        niche,
      },
    };

    try {
      const res = await fetch(`${base}/api/v1/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Client-Name": "TrendCraft",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        try {
          assertSwayBeesMode(data.mode, execution.mode);
        } catch (error) {
          return NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "SwayBees mode mismatch.",
              modeMismatch: true,
              taskIds: [
                ...successes.map((s) => s.taskId),
                ...(typeof data.taskId === "string" ? [data.taskId] : []),
              ],
            },
            { status: 502 },
          );
        }
        successes.push(data as RealApiSuccess);
      } else {
        failures.push({
          type: c.taskType,
          status: res.status,
          error: data.error ?? "unknown error",
        });
      }
    } catch (e) {
      failures.push({
        type: c.taskType,
        status: 502,
        error: e instanceof Error ? e.message : "request failed",
      });
    }
  }

  if (successes.length === 0) {
    return NextResponse.json(
      {
        error:
          "SwayBees rejected every task type for this campaign. " +
          failures.map((f) => f.type + ": " + f.error).join("; "),
        failures,
      },
      { status: 502 },
    );
  }

  const uniqueCreatorIds = new Set<string>();
  let totalInvitations = 0;
  let eligiblePoolSize = 0;
  for (const s of successes) {
    totalInvitations += s.invitationsCreated;
    eligiblePoolSize = Math.max(eligiblePoolSize, s.eligiblePoolSize);
    for (const c of s.creators) uniqueCreatorIds.add(c.id);
  }

  return NextResponse.json({
    simulated: false,
    mode: execution.mode,
    influencersEngaged: uniqueCreatorIds.size,
    tasksCreated: totalInvitations,
    eligiblePoolSize,
    taskIds: successes.map((s) => s.taskId),
    partialFailure: failures.length > 0 ? failures : undefined,
  });
}
