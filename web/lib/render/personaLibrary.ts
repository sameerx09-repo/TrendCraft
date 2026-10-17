import type { BeatRole } from "./runwayPromptTemplates";
import type { RunwayClip } from "@/remotion/RunwayMultiClipRemix";

/**
 * The automation this file exists for: replacing per-post fresh Runway
 * generation (createVideoClip/getVideoClipStatus/downloadVideoClip — real
 * money, ~5-10s of Runway credits per beat, per post) with a lookup against
 * the reusable persona library built in the Runway fork
 * (HANDOVER_runway_persona_remix.md). $0 marginal cost per remix after the
 * one-time library build.
 *
 * Two deliberate role→asset decisions, both routing around a known failure
 * mode rather than fighting it:
 *
 * 1. "proof" role always uses the real product photo (Ken Burns pan/zoom),
 *    never a persona clip, for ANY persona. Two independent reasons
 *    converge on the same fix: (a) AI-generated product label text is
 *    unreliable (confirmed real drift: "Magnesium Night Renewal Cream" ->
 *    "Maggersum Night RenndCream" by the 3rd beat in earlier testing), and
 *    (b) the product-on-skin "application" beat has no working AI
 *    solution (6 real attempts, all failed — pose drift, no real contact,
 *    extra fingers; parked per the handover). A real photo sidesteps both
 *    at once, and doesn't need a per-persona version.
 * 2. setup/reveal/button roles pick from a small pool per (persona, role),
 *    seeded — deterministic (same post always renders the same way, but
 *    different posts get gesture variety).
 *
 * Persona selection (added when scaling past one identity): a remix picks
 * ONE persona, seeded from the post id, and stays on that persona across
 * all its own beats — mixing different women's faces within a single
 * remix would look broken, so the persona choice happens once per remix,
 * not once per beat. Different remixes land on different personas via the
 * same seeded mechanism. Only one real persona (Priya) exists today; this
 * structure is what makes adding a second/third just a data addition
 * (real anchor photo + real generated clips) rather than a code change.
 *
 * Durations are real, ffprobe-measured values against the actual files in
 * public/persona-library/, converted to frames at this composition's 30fps
 * — not assumed from the generation request's nominal duration.
 */

export interface PersonaLibraryClip {
  videoSrc: string; // relative to public/
  durationInFrames: number;
  label: string;
}

interface Persona {
  id: string;
  label: string;
  clips: Record<"setup" | "reveal" | "button", PersonaLibraryClip[]>;
}

const PERSONAS: Persona[] = [
  {
    id: "priya",
    label: "Priya",
    clips: {
      setup: [
        { videoSrc: "persona-library/priya-hook.mp4", durationInFrames: 151, label: "calm direct eye contact" },
        { videoSrc: "persona-library/priya-deadpan.mp4", durationInFrames: 151, label: "flat deadpan stare" },
      ],
      reveal: [
        { videoSrc: "persona-library/priya-reveal.mp4", durationInFrames: 213, label: "head-turn glow reveal" },
        { videoSrc: "persona-library/priya-smirk.mp4", durationInFrames: 151, label: "playful smirk reaction" },
      ],
      button: [
        { videoSrc: "persona-library/priya-point.mp4", durationInFrames: 151, label: "point to camera CTA" },
        { videoSrc: "persona-library/priya-hairtuck.mp4", durationInFrames: 151, label: "hair tuck close" },
      ],
    },
  },
  {
    id: "meera",
    label: "Meera",
    // Regenerated 2026-10-03 on Gen-4.5 (runway/gen-4.5, $0.12/sec, vs. the
    // original gen4_turbo set's $0.05/sec) — replaces the old skincare-
    // narrative clips (glow reveal, hair-tuck) with a deliberately generic,
    // brand-agnostic set: every clip is a pure facial/upper-body expression,
    // no hand-to-face or hand-to-hair contact anywhere, so it reads
    // naturally under a caption for ANY brand category, not just beauty.
    // Dense (2fps) frame-by-frame review before wiring in: no anatomy
    // glitches, no hair-length drift, no identity/outfit breaks on any of
    // the 6 — the one real, repeated defect found was decorative background
    // objects (flowers near the mirror) flickering in/out between frames on
    // 3 of 6 clips, confined to the background, never the subject. Old
    // gen4_turbo clips (meera-hook.mp4 etc.) left on disk, just no longer
    // referenced here.
    clips: {
      setup: [
        {
          videoSrc: "persona-library/meera-2026-10-03-gen45-curious-eye-contact.mp4",
          durationInFrames: 121,
          label: "curious direct eye contact",
        },
        {
          videoSrc: "persona-library/meera-2026-10-03-gen45-surprised-reaction.mp4",
          durationInFrames: 121,
          label: "surprised reaction",
        },
      ],
      reveal: [
        {
          videoSrc: "persona-library/meera-2026-10-03-gen45-happy-smile-reveal.mp4",
          durationInFrames: 121,
          label: "genuine happy smile",
        },
        {
          videoSrc: "persona-library/meera-2026-10-03-gen45-impressed-relieved.mp4",
          durationInFrames: 121,
          label: "impressed relieved reaction",
        },
      ],
      button: [
        {
          videoSrc: "persona-library/meera-2026-10-03-gen45-point-to-camera.mp4",
          durationInFrames: 121,
          label: "point to camera CTA",
        },
        {
          videoSrc: "persona-library/meera-2026-10-03-gen45-confident-nod.mp4",
          durationInFrames: 121,
          label: "confident nod",
        },
      ],
    },
  },
  {
    id: "ananya",
    label: "Ananya",
    clips: {
      setup: [
        { videoSrc: "persona-library/ananya-hook.mp4", durationInFrames: 211, label: "calm direct eye contact" },
        { videoSrc: "persona-library/ananya-deadpan.mp4", durationInFrames: 211, label: "flat deadpan stare" },
      ],
      reveal: [{ videoSrc: "persona-library/ananya-reveal.mp4", durationInFrames: 212, label: "head-turn reveal" }],
      button: [{ videoSrc: "persona-library/ananya-point.mp4", durationInFrames: 212, label: "point to camera CTA" }],
    },
  },
  // diya and kavya are NOT registered here yet — each still only has
  // setup-role clips (hook/deadpan), no reveal or button clip, so picking
  // them would break the reveal/button beats of any remix that landed on
  // them. Add once each has at least one clip per role (see
  // scripts/personaBatchResults.json and scripts/generatePersonaBatchDirect.ts
  // for what's still missing). They DO appear on the /personas page — see
  // ALL_PERSONAS below, which is display-only and never used for picking.
];

/**
 * Display-only registry for the /personas page — every persona that has at
 * least one real clip, live or not, plus an anchor photo for identification
 * (per PERSONA_ROSTER_PLAN.md's "which one was which" gap). Never imported
 * by pickPersona/pickPersonaClip: keeping this separate from PERSONAS above
 * means adding a persona here can't accidentally make an incomplete one
 * pickable, and vice versa.
 */
export interface PersonaDisplayInfo {
  id: string;
  label: string;
  status: "live" | "incomplete";
  anchorPhoto: string; // relative to public/
  anchorIsRealAnchor: boolean; // false = extracted from a clip frame, no separate anchor file exists
  clips: Partial<Record<"setup" | "reveal" | "button", PersonaLibraryClip[]>>;
}

export const ALL_PERSONAS: PersonaDisplayInfo[] = [
  {
    id: "priya",
    label: "Priya",
    status: "live",
    anchorPhoto: "persona-library/priya-anchor.jpg",
    anchorIsRealAnchor: false, // original anchor was sourced outside the repo, before file-tracking started this session
    clips: PERSONAS[0].clips,
  },
  {
    id: "meera",
    label: "Meera",
    status: "live",
    anchorPhoto: "persona-library/meera-anchor.jpg",
    anchorIsRealAnchor: true,
    clips: PERSONAS[1].clips,
  },
  {
    id: "ananya",
    label: "Ananya",
    status: "live",
    anchorPhoto: "persona-library/ananya-anchor.jpg",
    anchorIsRealAnchor: true,
    clips: PERSONAS[2].clips,
  },
  {
    id: "diya",
    label: "Diya",
    status: "incomplete",
    anchorPhoto: "persona-library/diya-anchor.jpg",
    anchorIsRealAnchor: true,
    clips: {
      setup: [
        { videoSrc: "persona-library/diya-hook.mp4", durationInFrames: 211, label: "calm direct eye contact" },
        { videoSrc: "persona-library/diya-deadpan.mp4", durationInFrames: 211, label: "flat deadpan stare" },
      ],
    },
  },
  {
    id: "kavya",
    label: "Kavya",
    status: "incomplete",
    anchorPhoto: "persona-library/kavya-anchor.jpg",
    anchorIsRealAnchor: true,
    clips: {
      setup: [{ videoSrc: "persona-library/kavya-hook.mp4", durationInFrames: 211, label: "calm direct eye contact" }],
    },
  },
];

const PROOF_IMAGE = { imageSrc: "glovibe-product.jpg", durationInFrames: 90 }; // 3s @ 30fps, matches the old BEAT_DURATION_SECONDS.proof

/**
 * Per-role default caption position (RunwayClip.captionPosition, added to
 * fix the previously-hardcoded-bottom placement in ClipShot). This is a
 * heuristic default per role, NOT position extracted from any specific
 * source reel — a real per-source extraction would need a vision/Claude
 * pass over the actual scraped video, which is out of scope (see
 * phase1_phase2_build_tasklist.md's "except remix" framing; this whole
 * pipeline runs on the mock Claude client).
 *
 * Reasoning for the split: setup/reveal are face-forward persona shots
 * where the expression is the point — top placement (the "under the
 * handle" pattern the handover doc noted as common in real reels) keeps
 * the mouth/lower face visible instead of covered by bottom text. button
 * (the CTA/closing line) and proof (the product photo, where the label
 * sits mid-frame) both read fine with a conventional bottom caption.
 */
const ROLE_CAPTION_POSITION: Record<BeatRole, "top" | "bottom"> = {
  setup: "top",
  reveal: "top",
  proof: "bottom",
  button: "bottom",
};

/** Simple deterministic string hash — good enough for "pick consistently
 * per seed," not a real hashing algorithm. */
function seededIndex(seed: string, poolLength: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % poolLength;
}

/** Picks ONE persona for a remix — call this once per post (seeded by
 * postId), not once per beat, so all of a post's beats stay on the same
 * face. Three personas (Priya, Meera, Ananya) are registered with full
 * setup/reveal/button clips today; the seeding varies which one a given
 * remix lands on. */
export function pickPersona(seed: string): Persona {
  return PERSONAS[seededIndex(seed, PERSONAS.length)];
}

/** Looks up a specific persona by id — for the Generate AI UGC workflow,
 * where an admin explicitly picks a face rather than letting pickPersona
 * seed one randomly. Only resolves ids present in PERSONAS (the pickable,
 * fully-clipped roster) — a display-only ALL_PERSONAS id like "diya" or
 * "kavya" (incomplete, missing reveal/button clips) returns undefined, same
 * as an unknown id, so callers fall back the same way for both cases. */
export function getPersonaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

/** Returns a real, ready-to-render clip for a beat within an
 * already-chosen persona — no Runway API call involved. Caption is the
 * caller's responsibility (the beat's own script text, per the existing
 * remix — no new Claude call here). */
export function pickPersonaClip(persona: Persona, role: BeatRole, seed: string): Omit<RunwayClip, "caption"> {
  const captionPosition = ROLE_CAPTION_POSITION[role];
  if (role === "proof") {
    return {
      type: "image",
      imageSrc: PROOF_IMAGE.imageSrc,
      durationInFrames: PROOF_IMAGE.durationInFrames,
      captionPosition,
    };
  }
  const pool = persona.clips[role];
  const clip = pool[seededIndex(seed, pool.length)];
  return { type: "video", videoSrc: clip.videoSrc, durationInFrames: clip.durationInFrames, captionPosition };
}
