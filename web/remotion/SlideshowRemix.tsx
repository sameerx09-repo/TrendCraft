import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

export interface SlideshowRemixProps {
  slides: string[];
  brandPrimary: string;
  brandSecondary: string;
  brandName: string;
}

const FRAMES_PER_SLIDE = 75; // 2.5s @ 30fps

/** Dynamic duration — a post's slide count varies, so Root.tsx registers
 * this composition with calculateMetadata rather than a fixed frame count. */
export function calculateSlideshowDuration(slides: string[]): number {
  return slides.length * FRAMES_PER_SLIDE;
}

/**
 * One background per post (H4's simplest option, per
 * needs_deep_dive.md — background-varies-by-slide-role was flagged as a
 * real product photography question for later, not an infra gap; this
 * stays swappable once that's decided).
 */
export const SlideshowRemix: React.FC<SlideshowRemixProps> = ({ slides, brandPrimary, brandSecondary, brandName }) => {
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${brandPrimary}, ${brandSecondary})` }}>
      <div
        style={{
          position: "absolute",
          top: 44,
          width: "100%",
          textAlign: "center",
          color: "rgba(255,255,255,.75)",
          fontFamily: "Arial, sans-serif",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
      >
        {brandName}
      </div>
      {slides.map((text, i) => (
        <Sequence key={i} from={i * FRAMES_PER_SLIDE} durationInFrames={FRAMES_PER_SLIDE}>
          <Slide text={text} index={i} total={slides.length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Slide: React.FC<{ text: string; index: number; total: number }> = ({ text, index, total }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 15, stiffness: 180 } });
  const fadeOut = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(pop, fadeOut);
  const translateY = interpolate(pop, [0, 1], [20, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 70 }}>
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          color: "#fff",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          fontSize: 56,
          lineHeight: 1.25,
          textAlign: "center",
          textShadow: "0 4px 20px rgba(0,0,0,.3)",
        }}
      >
        {text}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 60,
          color: "rgba(255,255,255,.6)",
          fontFamily: "Arial, sans-serif",
          fontSize: 14,
          letterSpacing: 2,
        }}
      >
        {index + 1} / {total}
      </div>
    </AbsoluteFill>
  );
};
