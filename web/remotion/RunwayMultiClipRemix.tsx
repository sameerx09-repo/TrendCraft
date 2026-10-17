import { PreviewSceneLayout } from "../lib/mission-control/PreviewSceneLayout";
import {
  AbsoluteFill,
  Img,
  Sequence,
  Video,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

export interface RunwayClip {
  /** Defaults to "video". "image" beats use a real photo with a Ken Burns
   * pan/zoom instead of AI-generated video — text-on-product fidelity is a
   * known unsolved limitation of video diffusion models (confirmed by real
   * label-text drift in a paid Runway test: "Magnesium Night Renewal Cream"
   * degraded to "Maggersum Night RenndCream" by the 3rd beat), so any beat
   * where the label needs to be legible should use the real photo instead
   * of asking the model to regenerate it. */
  type?: "video" | "image";
  videoSrc?: string; // relative to public/, required when type is "video" (or omitted)
  imageSrc?: string; // relative to public/, required when type is "image"
  fit?: "contain" | "cover";
  muted?: boolean;
  still?: boolean;
  durationInFrames: number;
  caption: string;
  /**
   * Defaults to "bottom" (the original hardcoded behavior) when no real
   * signal exists. Where possible this is now REAL data — read straight off
   * the specific source reel's own thumbnail by
   * lib/clients/captionStyleAnalyzer.ts, not just a per-role guess. That
   * was the actual fix for "text placement is really lacking... same size,
   * placement, font" every time: callers (lib/inngest/functions.ts) pass
   * the matched trend item's captured captionPosition when it has one,
   * falling back to personaLibrary.ts's per-role default otherwise.
   */
  captionPosition?: "top" | "middle" | "bottom";
  /** Same sourcing as captionPosition — how big THIS reel's own caption
   * actually reads, not a guess. Falls back to the length-based sizing in
   * captionFontSize below when absent. */
  captionSizeHint?: "small" | "medium" | "large" | "huge";
  /** Same sourcing as captionPosition/captionSizeHint — whether THIS
   * reel's real caption sits on a solid white box (the common meme
   * caption style) rather than plain text over the video. Confirmed live
   * this was the other real gap behind a remix looking visibly "thin" next
   * to its source: only position/size were ever captured, never this.
   * Defaults to the existing plain-text-with-stroke look when absent. */
  captionHasBackground?: boolean;
  /**
   * Optional: play multiple caption lines IN SEQUENCE over this one clip's
   * duration, instead of showing `caption` statically for the whole thing —
   * lib/render/artifactMedia.ts's prepareArtifactClip sets this when a
   * single real clip is carrying more than one beat of copy (e.g. only 1
   * artifact was uploaded but there are 3 lines of generated ad copy).
   * Confirmed live that showing every line simultaneously, stacked as one
   * block, read as an incoherent run-on — a punchy hook immediately
   * followed by unrelated ad copy with zero separation. This is what an
   * actual single-video ad looks like instead: hook, then payoff, then
   * CTA, each getting its own clean moment. Entries' durationInFrames
   * should sum to exactly this clip's own durationInFrames. When absent,
   * `caption` renders for the clip's entire duration (unchanged behavior
   * for every other caller — persona-library, runway, multi-artifact).
   */
  captions?: { text: string; durationInFrames: number }[];
}

export interface RunwayMultiClipRemixProps {
  clips: RunwayClip[];
  brandName: string;
  previewStyle?: boolean;
}

/** Sums real per-clip durations — dynamic via calculateMetadata in Root.tsx,
 * same pattern as SlideshowRemix's calculateSlideshowDuration. */
export function calculateMultiClipDuration(clips: RunwayClip[]): number {
  return clips.reduce((sum, c) => sum + c.durationInFrames, 0);
}

/**
 * Stitches separately-generated (or, for this fixture test, split-from-one)
 * video clips into one sequence with captions — the actual fix for the
 * "one generation trying to do everything" problem that caused the
 * object-permanence bug (see lib/render/runwayPromptTemplates.ts's doc
 * comment). Each clip plays full-bleed for its own duration; captions
 * overlay per-clip, not word-timed (we don't have real per-clip speech
 * timing here — these are B-roll/action clips, not talking-head audio).
 */
export const RunwayMultiClipRemix: React.FC<RunwayMultiClipRemixProps> = ({
  clips,
  brandName,
  previewStyle,
}) => {
  const starts = clips.map((_, i) =>
    clips.slice(0, i).reduce((sum, clip) => sum + clip.durationInFrames, 0),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {!previewStyle && <BrandMark brandName={brandName} />}
      {clips.map((clip, i) => (
        <Sequence
          key={i}
          from={starts[i]}
          durationInFrames={clip.durationInFrames}
        >
          <ClipShot
            clip={clip}
            previewStyle={previewStyle}
            brandName={brandName}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const BrandMark: React.FC<{ brandName: string }> = ({ brandName }) => (
  <div
    style={{
      position: "absolute",
      top: 40,
      width: "100%",
      textAlign: "center",
      color: "rgba(255,255,255,.75)",
      fontFamily: "Arial, sans-serif",
      fontWeight: 700,
      fontSize: 18,
      letterSpacing: 3,
      textTransform: "uppercase",
      zIndex: 10,
    }}
  >
    {brandName}
  </div>
);

/** Real viral captions read as big, thick, high-contrast "sticker" text —
 * confirmed against actual source reels (e.g. "My grandma taught me this
 * method") which use a heavy font with a hard outline, not a thin weight
 * with a soft blur shadow. The prior fixed 34px/Arial-800/blur-shadow
 * treatment made every caption look flat and small by comparison,
 * regardless of what the text said. Sizing also now responds to length:
 * copy is generated short now (see productCopywriter.ts), but this is the
 * safety net so a longer line shrinks to fit instead of just wrapping
 * into a denser, weaker-looking block at a fixed size. */
const SIZE_HINT_BASE_PX: Record<
  NonNullable<RunwayClip["captionSizeHint"]>,
  number
> = {
  small: 30,
  medium: 38,
  large: 46,
  huge: 54,
};

function captionFontSize(
  text: string,
  sizeHint?: RunwayClip["captionSizeHint"],
): number {
  const base = sizeHint ? SIZE_HINT_BASE_PX[sizeHint] : 38;
  // Scales down PROPORTIONALLY for longer text instead of clamping to a
  // fixed absolute floor regardless of hint — confirmed live the old fixed
  // floors (28/36/42) flattened every hint tier to the same small size
  // once text passed ~60 chars: a real "large"-hinted 68-char caption
  // rendered at 28px, visibly smaller/thinner than its actual source,
  // indistinguishable from what a "small" hint would have produced at the
  // same length. This keeps hint tiers meaningfully different at any
  // length while still shrinking long copy enough to avoid overflow.
  let scale = 1;
  if (text.length > 90) scale = 0.55;
  else if (text.length > 60) scale = 0.7;
  else if (text.length > 45) scale = 0.82;
  else if (text.length > 30) scale = 0.92;
  return Math.round(base * scale);
}

const ClipShot: React.FC<{
  clip: RunwayClip;
  previewStyle?: boolean;
  brandName?: string;
}> = ({ clip, previewStyle, brandName }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Sequential multi-caption support (see RunwayClip.captions's doc
  // comment): find which caption is active at this frame and compute its
  // own local pop-in/fade-out relative to ITS OWN sub-range, not the whole
  // clip's — each line gets a clean entrance/exit instead of one static
  // block spanning the entire clip. Falls back to the single `caption`
  // (existing behavior, all other callers) when `captions` is absent.
  let activeCaption = clip.caption;
  let localFrame = frame;
  let localDuration = durationInFrames;
  if (clip.captions && clip.captions.length > 0) {
    let cursor = 0;
    for (const c of clip.captions) {
      if (frame >= cursor && frame < cursor + c.durationInFrames) {
        activeCaption = c.text;
        localFrame = frame - cursor;
        localDuration = c.durationInFrames;
        break;
      }
      cursor += c.durationInFrames;
    }
  }

  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 200 },
  });
  const fadeOut = interpolate(
    localFrame,
    [localDuration - 6, localDuration],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const captionOpacity = Math.min(pop, fadeOut);

  const kenBurnsScale = interpolate(frame, [0, durationInFrames], [1, 1.12], {
    extrapolateRight: "clamp",
  });

  const media =
    clip.type === "image" ? (
      <Img
        src={
          /^(https?:|data:|blob:)/.test(clip.imageSrc!)
            ? clip.imageSrc!
            : staticFile(clip.imageSrc!)
        }
        style={{
          width: "100%",
          height: "100%",
          objectFit: clip.fit ?? "cover",
          transform: clip.still ? "none" : `scale(${kenBurnsScale})`,
        }}
      />
    ) : (
      <Video
        muted={clip.muted}
        src={
          /^(https?:|data:|blob:)/.test(clip.videoSrc!)
            ? clip.videoSrc!
            : staticFile(clip.videoSrc!)
        }
        style={{
          width: "100%",
          height: "100%",
          objectFit: clip.fit ?? "cover",
        }}
      />
    );
  if (previewStyle)
    return (
      <AbsoluteFill>
        <PreviewSceneLayout brandName={brandName || ""} caption={activeCaption}>
          {media}
        </PreviewSceneLayout>
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill>
      {media}
      <AbsoluteFill
        style={
          clip.captionPosition === "top"
            ? {
                justifyContent: "flex-start",
                alignItems: "center",
                paddingTop: 90,
              }
            : clip.captionPosition === "middle"
              ? { justifyContent: "center", alignItems: "center" }
              : {
                  justifyContent: "flex-end",
                  alignItems: "center",
                  paddingBottom: 90,
                }
        }
      >
        <div
          style={
            clip.captionHasBackground
              ? {
                  // The other real, common caption style — a solid white/
                  // near-white rounded box with dark text — confirmed live
                  // this was never built at all: every caption rendered as
                  // plain white text with a stroke/shadow regardless of
                  // whether the source reel actually used a box. Dark text
                  // on a light box reads correctly here; white-text
                  // stroke/shadow would be illegible against a light
                  // background, so this is a genuinely different style, not
                  // a variant of the one below.
                  opacity: captionOpacity,
                  color: "#111",
                  background: "rgba(255,255,255,.96)",
                  fontFamily: "'Arial Black', Impact, Arial, sans-serif",
                  fontWeight: 800,
                  fontSize: captionFontSize(
                    activeCaption,
                    clip.captionSizeHint,
                  ),
                  whiteSpace: "pre-line",
                  lineHeight: 1.3,
                  textAlign: "center",
                  padding: "16px 28px",
                  borderRadius: 16,
                  maxWidth: "82%",
                  boxShadow: "0 6px 20px rgba(0,0,0,.35)",
                }
              : {
                  opacity: captionOpacity,
                  color: "#fff",
                  fontFamily: "'Arial Black', Impact, Arial, sans-serif",
                  fontWeight: 900,
                  fontSize: captionFontSize(
                    activeCaption,
                    clip.captionSizeHint,
                  ),
                  whiteSpace: "pre-line",
                  lineHeight: 1.3,
                  textAlign: "center",
                  padding: "0 40px",
                  WebkitTextStroke: "1.5px rgba(0,0,0,.85)",
                  textShadow:
                    "0 2px 4px rgba(0,0,0,.6), 0 6px 18px rgba(0,0,0,.45)",
                }
          }
        >
          {activeCaption}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
