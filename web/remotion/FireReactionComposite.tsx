import { AbsoluteFill, Img, Video, staticFile, useCurrentFrame, interpolate } from "remotion";

/**
 * One-off test: composite two INDEPENDENTLY-SOURCED ingredients (a licensed
 * fire background video + a licensed chromakey-cut reaction photo) instead
 * of trying to find/generate the finished meme image whole. Caption style
 * deliberately recreates the source reel's actual look (white rounded box,
 * black text) rather than reusing RunwayMultiClipRemix's sticker-text
 * treatment, since that's genuinely a different visual style from what
 * reel 2/reel 5 actually use.
 */
export const FireReactionComposite: React.FC = () => {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [0, 10], [0.9, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video src={staticFile("test-assets/fire-bg-fit.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 60 }}>
        <Img
          src={staticFile("test-assets/shocked-cutout-full.png")}
          style={{ width: 620, transform: `scale(${pop})`, transformOrigin: "bottom center" }}
        />
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", paddingTop: 140 }}>
        <div
          style={{
            background: "#fff",
            color: "#000",
            fontFamily: "Arial, sans-serif",
            fontWeight: 800,
            fontSize: 38,
            lineHeight: 1.2,
            textAlign: "center",
            padding: "20px 28px",
            borderRadius: 4,
            maxWidth: 600,
          }}
        >
          When your skin sends you to hell for your bad habits
        </div>
        <div
          style={{
            marginTop: 24,
            background: "#fff",
            color: "#000",
            fontFamily: "Arial, sans-serif",
            fontWeight: 800,
            fontSize: 38,
            textAlign: "center",
            padding: "20px 28px",
            borderRadius: 4,
          }}
        >
          but then:
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
