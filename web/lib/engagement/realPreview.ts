import { assertSwayBeesMode, type SwayBeesMode } from "./swaybees-mode";
import { inrToUsd } from "./fx";

// "Scope" now means SwayBees' real engagementRate tier (buckets creators
// by their actual engagement %: low 0-2%, medium 2-5%, high 5%+ — see
// GET /api/v1/tasks/preview on the SwayBees side), not a follower-count
// minimum like the earlier version of this feature used. SwayBees' public
// API has no follower-count filter at all, so that was never enforceable
// server-side anyway — this aligns the UI with what's actually real.
export type Scope = "low" | "medium" | "high";
export type Goal = "reach" | "engagement" | "ugc";
export type RealTaskType = "UGC" | "Engagement" | "Reach";

export const GOAL_TO_REAL_TYPE: Record<Goal, RealTaskType> = {
  ugc: "UGC",
  engagement: "Engagement",
  reach: "Reach",
};

/** UGC and Reach map to one concrete TaskType each. "Engagement" doesn't
 * — the real TaskType enum has three engagement-shaped actions (COMMENT,
 * LIKE, TAG_FRIEND) and the preview endpoint blends them into one bucket
 * with one cost. Split that bucket's task count evenly across the three
 * via splitEngagementTasks below, rather than creating only COMMENT (an
 * earlier version of this file did that, mirroring SwayBees' own
 * generateTasksForBrand — wrong here, since that function really does
 * only ever create COMMENT; it's not evidence "Engagement" means
 * COMMENT-only for this endpoint). */
export const SIMPLE_TYPE_MAP: Record<"UGC" | "Reach", "UGC_VIDEO" | "SHARE"> = {
  UGC: "UGC_VIDEO",
  Reach: "SHARE",
};

export const ENGAGEMENT_SUB_TYPES = ["COMMENT", "LIKE", "TAG_FRIEND"] as const;
export type EngagementSubType = (typeof ENGAGEMENT_SUB_TYPES)[number];

/** Splits `total` into `buckets` integer parts as evenly as possible
 * (remainder distributed to the first buckets) — e.g. splitEvenly(10, 3)
 * = [4, 3, 3]. Used so the preview panel and the real task-creation calls
 * divide an Engagement bucket's task count identically. */
export function splitEvenly(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from(
    { length: buckets },
    (_, i) => base + (i < remainder ? 1 : 0),
  );
}

export interface EngagementSubGroup {
  type: EngagementSubType;
  countTasks: number;
  payoutPerTask: number; // same unit cost as the blended bucket
  totalCost: number;
}

export function splitEngagementTasks(
  countTasks: number,
  costPerTask: number,
): EngagementSubGroup[] {
  const counts = splitEvenly(countTasks, ENGAGEMENT_SUB_TYPES.length);
  return ENGAGEMENT_SUB_TYPES.map((type, i) => ({
    type,
    countTasks: counts[i],
    payoutPerTask: costPerTask,
    totalCost: counts[i] * costPerTask,
  }));
}

export interface RealPreviewBreakdown {
  type: RealTaskType;
  costPerTask: number; // USD
  eligiblePoolSize: number;
  maxTasksFromBudget: number;
  projectedTasks: number;
  projectedInfluencers: number;
  budgetUsed: number; // USD
}

export interface RealPreview {
  mode: SwayBeesMode;
  amountUsd: number;
  engagementRate: Scope;
  types: RealTaskType[];
  budgetPerTypeUsd: number;
  breakdown: RealPreviewBreakdown[];
  totals: {
    projectedTasks: number;
    projectedInfluencers: number;
    budgetUsedUsd: number;
    budgetRemainingUsd: number;
  };
}

/** Calls SwayBees' real GET /api/v1/tasks/preview — the live source of
 * truth for both the preview panel and (via submit's own call to this
 * same function) the actual task-creation payouts, so the two can't
 * drift from each other the way a locally-reinvented rate card could. */
export async function fetchRealPreview(
  budgetInr: number,
  scope: Scope,
  goals: Goal[],
  mode: SwayBeesMode,
): Promise<RealPreview> {
  const base = process.env.SWAYBEES_API_URL;
  const apiKey = process.env.SWAYBEES_API_KEY;
  if (!base || !apiKey) throw new Error("SwayBees integration not configured");

  const amountUsd = inrToUsd(budgetInr);
  const types = goals.map((g) => GOAL_TO_REAL_TYPE[g]);
  const qs = new URLSearchParams({
    amount: String(amountUsd),
    engagementRate: scope,
    mode,
  });
  for (const t of types) qs.append("type", t);

  const res = await fetch(`${base}/api/v1/tasks/preview?${qs.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Client-Name": "TrendCraft",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Preview failed");
  assertSwayBeesMode(data.mode, mode);

  return {
    mode: data.mode,
    amountUsd: data.amount,
    engagementRate: data.engagementRate,
    types: data.types,
    budgetPerTypeUsd: data.budgetPerType,
    breakdown: data.breakdown,
    totals: {
      projectedTasks: data.totals.projectedTasks,
      projectedInfluencers: data.totals.projectedInfluencers,
      budgetUsedUsd: data.totals.budgetUsed,
      budgetRemainingUsd: data.totals.budgetRemaining,
    },
  };
}
