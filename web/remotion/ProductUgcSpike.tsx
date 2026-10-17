import { AbsoluteFill, Img, Sequence, Video, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const clips = {
  curious: "persona-library/meera-2026-10-03-gen45-curious-eye-contact.mp4",
  smile: "persona-library/meera-2026-10-03-gen45-happy-smile-reveal.mp4",
  point: "persona-library/meera-2026-10-03-gen45-point-to-camera.mp4",
  product: "glovibe-product.jpg",
};

const FPS = 30;
const beats = {
  hook: 4 * FPS,
  product: 3 * FPS,
  reaction: 4 * FPS,
  cta: 4 * FPS,
};

export const PRODUCT_UGC_SPIKE_DURATION =
  beats.hook + beats.product + beats.reaction + beats.cta;

function Caption({
  text,
  sub,
  align = "bottom",
}: {
  text: string;
  sub?: string;
  align?: "top" | "middle" | "bottom";
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 15, stiffness: 180 } });
  const fade = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: align === "top" ? "flex-start" : align === "middle" ? "center" : "flex-end",
        alignItems: "center",
        padding: align === "top" ? "94px 42px 0" : align === "bottom" ? "0 42px 98px" : "0 42px",
      }}
    >
      <div
        style={{
          opacity: Math.min(pop, fade),
          transform: `scale(${0.96 + pop * 0.04})`,
          color: "#fff",
          fontFamily: "'Arial Black', Impact, Arial, sans-serif",
          fontSize: text.length > 42 ? 38 : 46,
          lineHeight: 1.12,
          textAlign: "center",
          WebkitTextStroke: "1.4px rgba(0,0,0,.82)",
          textShadow: "0 8px 26px rgba(0,0,0,.55)",
        }}
      >
        {text}
        {sub && (
          <div
            style={{
              marginTop: 14,
              display: "inline-block",
              color: "#111",
              background: "rgba(255,255,255,.94)",
              borderRadius: 999,
              padding: "10px 18px",
              fontFamily: "Arial, sans-serif",
              fontSize: 22,
              fontWeight: 800,
              WebkitTextStroke: "0 transparent",
              textShadow: "none",
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

function BrandMark() {
  return (
    <div
      style={{
        position: "absolute",
        top: 34,
        left: 0,
        width: "100%",
        textAlign: "center",
        color: "rgba(255,255,255,.8)",
        fontFamily: "Arial, sans-serif",
        fontWeight: 900,
        letterSpacing: 4,
        fontSize: 18,
        textTransform: "uppercase",
        zIndex: 20,
      }}
    >
      GloVibe
    </div>
  );
}

function ProductPackshot({ compact = false }: { compact?: boolean }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 120], compact ? [1, 1.035] : [1, 1.12], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: compact ? 250 : 420,
        height: compact ? 330 : 520,
        borderRadius: 30,
        background: "linear-gradient(160deg, #f6eee4, #dbc6ae)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 24px 70px rgba(0,0,0,.38)",
        overflow: "hidden",
      }}
    >
      <Img
        src={staticFile(clips.product)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          padding: compact ? 14 : 24,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

function ProductBeat() {
  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(circle at 50% 25%, #6f805f 0, #2c3328 44%, #090b09 100%)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ProductPackshot />
      <Caption text="One night cream doing the heavy lifting." sub="real product image" align="bottom" />
    </AbsoluteFill>
  );
}

function FinalBeat() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video src={staticFile(clips.point)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div
        style={{
          position: "absolute",
          right: 36,
          bottom: 228,
          zIndex: 12,
        }}
      >
        <ProductPackshot compact />
      </div>
      <Caption text="GloVibe Magnesium Night Renewal Cream" sub="Link in bio" align="top" />
    </AbsoluteFill>
  );
}

export const ProductUgcSpike: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <BrandMark />
      <Sequence from={0} durationInFrames={beats.hook}>
        <Video src={staticFile(clips.curious)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <Caption text="I tried skipping the 7-step night routine." />
      </Sequence>
      <Sequence from={beats.hook} durationInFrames={beats.product}>
        <ProductBeat />
      </Sequence>
      <Sequence from={beats.hook + beats.product} durationInFrames={beats.reaction}>
        <Video src={staticFile(clips.smile)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <Caption text="Woke up to skin that felt calm." />
      </Sequence>
      <Sequence from={beats.hook + beats.product + beats.reaction} durationInFrames={beats.cta}>
        <FinalBeat />
      </Sequence>
    </AbsoluteFill>
  );
};
