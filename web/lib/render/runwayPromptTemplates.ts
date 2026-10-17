/**
 * Deterministic (no live Claude call — real remix generation is out of
 * scope for this build pass, see phase1_phase2_build_tasklist.md) per-beat
 * Runway prompt construction, keyed by beat role within a hook_type.
 *
 * Core rule, learned from a real generation defect this session: a single
 * clip's prompt must describe ONE continuous physical action that the
 * anchor image already supports — never introduce a new object mid-clip
 * (a jar materializing already-open, with no reach/grab motion, read as
 * genuinely broken, not just imperfect). Each beat's clip either has no
 * product (safe, nothing to introduce) or is anchored with a real image
 * showing the product already correctly positioned for that beat's action.
 */

export type BeatRole = "setup" | "reveal" | "proof" | "button";

export interface BeatPromptInput {
  role: BeatRole;
  text: string; // the beat's script line, spoken content is handled separately (captions) — this informs tone only
  productImageUrl?: string; // only for beats where the product should be anchored via first_frame
}

const ROLE_DIRECTION: Record<BeatRole, (hasProduct: boolean) => string> = {
  setup: () =>
    "A young woman sits calm and still, direct eye contact with the camera, deadpan and unhurried, a small relaxed hand gesture near her face — low energy, holding for several seconds, handheld phone-camera feel, warm indoor lighting.",
  reveal: (hasProduct) =>
    hasProduct
      ? "Starting from this exact product shot, the camera pulls back to reveal a woman's hand already holding it steady. She reacts with a big genuine laugh, head tilting back, lifting the product further into frame with natural motion blur — high energy, dramatic, full-body movement."
      : "A woman bursts into a big genuine laugh, head tilting back, hands moving energetically — high energy, dramatic, full-body movement, natural motion blur.",
  proof: (hasProduct) =>
    hasProduct
      ? "Starting from this exact product shot, the camera holds steady in close-up as fingers gently turn the jar, catching the light — calm, confident, deliberate movement, nothing rushed."
      : "Calm, confident close-up on hands demonstrating with deliberate, unhurried movement.",
  button: (hasProduct) =>
    hasProduct
      ? "Starting from this exact product shot, a woman's calm face comes into focus behind it, holding it steady — she settles into stillness, matching a relaxed, unhurried close."
      : "A woman settles back into calm stillness, matching a relaxed, unhurried close.",
};

const NEGATIVE_SUFFIX =
  " No text overlays, no on-screen captions, no invented product claims, no other products or logos beyond what's shown in the reference image.";

export function buildBeatPrompt(input: BeatPromptInput): string {
  const hasProduct = Boolean(input.productImageUrl);
  return ROLE_DIRECTION[input.role](hasProduct) + NEGATIVE_SUFFIX;
}

/** Maps a remix's beat array (currently just strings — see remixed_scripts.beats)
 * to roles positionally: first = setup, second = reveal, last = button,
 * anything in between = proof. Matches the 4-beat contrast-joke shape
 * that's the only hook_type we've built for so far — a real limitation,
 * not hidden: a hook_type with a different beat count would need its own
 * role-mapping, not this positional guess. */
export function assignBeatRoles(beats: string[]): BeatRole[] {
  if (beats.length === 0) return [];
  if (beats.length === 1) return ["setup"];
  return beats.map((_, i) => {
    if (i === 0) return "setup";
    if (i === beats.length - 1) return "button";
    if (i === 1) return "reveal";
    return "proof";
  });
}
