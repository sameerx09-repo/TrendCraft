import {
  AbsoluteFill,
  Sequence,
  Video,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";

export interface Segment {
  text: string;
  frames: number;
  /** true = brief cutaway to a branded card instead of the avatar shot,
   * for the "reveal" beat — see phase1_phase2_build_tasklist.md's
   * talking-head edit pass entry for why this exists. */
  cutaway?: boolean;
}

export interface TalkingHeadEditProps {
  videoSrc: string;
  brandPrimary: string;
  brandSecondary: string;
  brandName: string;
  segments: Segment[];
}

/**
 * The raw HeyGen output for this avatar look ("Kavya Sofa Front") is
 * landscape performance footage padded into a 720x1280 canvas with large
 * flat-gray bars top/bottom, not a native full-bleed vertical shot —
 * confirmed by inspecting rendered frames, not assumed. Cropping+upscaling
 * to fill the full canvas would need a ~3.5x zoom, which blurs the footage
 * and crops out her hands/arms — so instead of fighting that, the actual
 * content band is cropped at native resolution (no upscale, no blur) and
 * displayed inside a deliberately branded composition, rather than left
 * floating in HeyGen's default flat-gray padding.
 */
const VIDEO_CROP = { top: 450, height: 365 }; // pixels, in the 720x1280 source

export const TalkingHeadEdit: React.FC<TalkingHeadEditProps> = ({
  videoSrc,
  brandPrimary,
  brandSecondary,
  brandName,
  segments,
}) => {
  let frameCursor = 0;
  const starts = segments.map((s) => {
    const start = frameCursor;
    frameCursor += s.frames;
    return start;
  });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${brandPrimary}, ${brandSecondary})` }}>
      <BrandMark brandName={brandName} />

      {segments.map((seg, i) =>
        seg.cutaway ? null : (
          <Sequence key={`video-${i}`} from={starts[i]} durationInFrames={seg.frames}>
            <VideoCard videoSrc={videoSrc} />
          </Sequence>
        )
      )}

      {segments.map((seg, i) => (
        <Sequence key={`fg-${i}`} from={starts[i]} durationInFrames={seg.frames}>
          {seg.cutaway ? (
            <CutawayCard text={seg.text} />
          ) : (
            <Caption text={seg.text} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const BrandMark: React.FC<{ brandName: string }> = ({ brandName }) => (
  <div
    style={{
      position: "absolute",
      top: 44,
      width: "100%",
      textAlign: "center",
      color: "rgba(255,255,255,.8)",
      fontFamily: "Arial, sans-serif",
      fontWeight: 700,
      fontSize: 20,
      letterSpacing: 3,
      textTransform: "uppercase",
    }}
  >
    {brandName}
  </div>
);

/** Native-resolution crop of just the real footage band — no upscale, so
 * no blur, at the cost of not filling the full canvas edge to edge. */
const VideoCard: React.FC<{ videoSrc: string }> = ({ videoSrc }) => (
  <div
    style={{
      position: "absolute",
      top: 340,
      left: 0,
      width: 720,
      height: VIDEO_CROP.height,
      overflow: "hidden",
      boxShadow: "0 20px 45px rgba(0,0,0,.35)",
    }}
  >
    <Video
      src={staticFile(videoSrc)}
      style={{
        position: "absolute",
        top: -VIDEO_CROP.top,
        left: 0,
        width: 720,
        height: 1280,
      }}
    />
  </div>
);

const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 16, stiffness: 200 } });
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const translateY = interpolate(pop, [0, 1], [16, 0]);
  const opacity = Math.min(pop, fadeOut);

  return (
    <AbsoluteFill style={{ top: 340 + VIDEO_CROP.height, justifyContent: "flex-start", alignItems: "center" }}>
      <div
        style={{
          marginTop: 70,
          transform: `translateY(${translateY}px)`,
          opacity,
          color: "#fff",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          fontSize: 38,
          lineHeight: 1.28,
          textAlign: "center",
          padding: "0 56px",
          maxWidth: "100%",
          textShadow: "0 2px 14px rgba(0,0,0,.35)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const CutawayCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 16, stiffness: 200 } });
  const fadeOut = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(pop, fadeOut);
  const scale = interpolate(pop, [0, 1], [1.06, 1]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `scale(${scale})`,
        justifyContent: "center",
        alignItems: "center",
        padding: 60,
      }}
    >
      <div
        style={{
          color: "#fff",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          fontSize: 54,
          lineHeight: 1.25,
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: -0.5,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
