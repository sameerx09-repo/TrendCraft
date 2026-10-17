import type { Goal, Scope } from "./realPreview";

// Deliberately local sample rates; never presented as SwayBees quotes.
export function engagementTestPlan(
  budget: number,
  scope: Scope,
  goals: Goal[],
) {
  const factor = { low: 1, medium: 1.5, high: 2 }[scope];
  const perGoal = budget / goals.length;
  const taskGroups = goals.flatMap((goal) => {
    const rate = Math.round(
      { engagement: 60, reach: 80, ugc: 250 }[goal] * factor,
    );
    const count = Math.floor(perGoal / rate);
    const types =
      goal === "engagement"
        ? (["COMMENT", "LIKE", "TAG_FRIEND"] as const)
        : goal === "reach"
          ? (["SHARE"] as const)
          : (["UGC_VIDEO"] as const);
    return types.map((type, i) => {
      const countTasks =
        Math.floor(count / types.length) + (i < count % types.length ? 1 : 0);
      return {
        type,
        countTasks,
        payoutPerTask: rate,
        totalCost: countTasks * rate,
        eligiblePoolSize: 30,
      };
    });
  });
  const influencerCount = Math.max(0, ...taskGroups.map((g) => g.countTasks));
  const totalCost = taskGroups.reduce((sum, g) => sum + g.totalCost, 0);
  return {
    scope,
    goals,
    influencerCount,
    taskGroups,
    totalCost,
    remainingBudget: budget - totalCost,
    viable: influencerCount >= 3,
  };
}
