/**
 * Percentile-rank normalization (needs_deep_dive.md D1: "Percentile rank
 * within the current scrape batch is the simplest defensible choice —
 * self-calibrating. Fixed thresholds will age badly.")
 *
 * Deliberate simplification from the doc's exact wording: this ranks
 * against *all* of the brand's scored trend_items, not strictly "the
 * current scrape batch." The two scrape sources (Apify, YouTube) run as
 * separate, concurrently-executing Inngest functions with no shared batch
 * context (see the race-condition fix in lib/inngest/functions.ts) — true
 * per-batch ranking would need a batch_id column and a fan-in step neither
 * of which exist yet. Ranking against the whole brand corpus is still
 * self-calibrating and still gets fixed thresholds out of the picture,
 * just over a wider, always-consistent window instead of one refresh's
 * items. Revisit if/when batch tracking gets built.
 */
export function computePercentileRanks(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const sorted = [...scores].sort((a, b) => a - b);
  return scores.map((score) => {
    // Count of scores <= this one, minus itself, over n-1 possible steps.
    const countBelowOrEqual = sorted.filter((s) => s <= score).length;
    return Math.round(((countBelowOrEqual - 1) / (n - 1)) * 100);
  });
}
