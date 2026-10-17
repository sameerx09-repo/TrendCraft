// No real FX integration exists — SwayBees' real cost model (lib/pricing.ts
// there: UGC_COST=$40, BLENDED_COMMENT_COST=$1.5, REACH_COST=$1) is USD,
// while Drive Engagement's budget slider is ₹. Sending the raw ₹ number
// as `amount` would treat it as USD and wildly overcount tasks (₹1000 ≈
// 600+ projected creators at $1.5/task instead of ~10). This fixed
// approximate rate keeps the numbers sane; revisit with a real rate
// source if this ever handles real money.
export const INR_PER_USD = 83;

export function inrToUsd(inr: number): number {
  return inr / INR_PER_USD;
}

export function usdToInr(usd: number): number {
  return Math.round(usd * INR_PER_USD);
}
