import { Composition } from "remotion";
import { TalkingHeadEdit } from "./TalkingHeadEdit";
import { SlideshowRemix, calculateSlideshowDuration } from "./SlideshowRemix";
import { RunwayMultiClipRemix, calculateMultiClipDuration } from "./RunwayMultiClipRemix";
import { FireReactionComposite } from "./FireReactionComposite";
import { ProductUgcSpike, PRODUCT_UGC_SPIKE_DURATION } from "./ProductUgcSpike";
import { CURRENT_BRAND } from "../lib/config/brand";

/**
 * Segment timing is now real, not guessed: ffmpeg silencedetect on the
 * actual Kavya audio found sentence-boundary pauses at ~1.50s, ~2.46-3.99s,
 * ~4.96-8.51s, ~9.52s (the earlier version approximated by caption
 * character-length instead, which is what caused the caption/speech
 * disconnect a real review caught). Segment boundaries below are the
 * midpoints of each detected pause, in frames @30fps. Still not true
 * word-level sync (that needs HeyGen's caption/subtitle_url, not requested
 * on this real call) but now grounded in this clip's actual pauses, free,
 * no extra API spend. Segment 1 ("Kumkumadi oil is permanent.") is the
 * cutaway per the "reveal beat" idea discussed in
 * phase1_phase2_build_tasklist.md.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="TalkingHeadEdit"
      component={TalkingHeadEdit}
      durationInFrames={347}
      fps={30}
      width={720}
      height={1280}
      defaultProps={{
        videoSrc: "kavya-raw.mp4",
        brandPrimary: CURRENT_BRAND.primaryColor,
        brandSecondary: CURRENT_BRAND.secondaryColor,
        brandName: CURRENT_BRAND.name,
        segments: [
          { text: "Skincare trends are temporary.", frames: 59, cutaway: false },
          { text: "Kumkumadi oil is permanent.", frames: 75, cutaway: true },
          { text: "Three ingredients. Centuries of use. Zero reformulation.", frames: 137, cutaway: false },
          { text: "Some things don't need updating.", frames: 76, cutaway: false },
        ],
      }}
    />
    <Composition
      id="SlideshowRemix"
      component={SlideshowRemix}
      fps={30}
      width={720}
      height={1280}
      durationInFrames={4 * 75}
      calculateMetadata={async ({ props }) => ({
        durationInFrames: calculateSlideshowDuration((props as { slides: string[] }).slides),
      })}
      defaultProps={{
        slides: [
          "Skincare trends are temporary.",
          "Kumkumadi oil is permanent.",
          "Three ingredients. Centuries of use. Zero reformulation.",
          "Your skin deserves clarity.",
        ],
        brandPrimary: CURRENT_BRAND.primaryColor,
        brandSecondary: CURRENT_BRAND.secondaryColor,
        brandName: CURRENT_BRAND.name,
      }}
    />
    <Composition
      id="RunwayMultiClipRemix"
      component={RunwayMultiClipRemix}
      fps={30}
      width={720}
      height={1280}
      durationInFrames={78 + 34 + 46}
      calculateMetadata={async ({ props }) => ({
        durationInFrames: calculateMultiClipDuration((props as { clips: { durationInFrames: number }[] }).clips),
      })}
      defaultProps={{
        brandName: CURRENT_BRAND.name,
        clips: [
          { videoSrc: "clip_beat1_calm.mp4", durationInFrames: 78, caption: "Skincare trends are temporary." },
          { videoSrc: "clip_beat2_laugh.mp4", durationInFrames: 34, caption: "Kumkumadi oil is permanent." },
          { videoSrc: "clip_beat3_product.mp4", durationInFrames: 46, caption: "Some things don't need updating." },
        ],
      }}
    />
    <Composition
      id="FireReactionComposite"
      component={FireReactionComposite}
      fps={30}
      width={720}
      height={1280}
      durationInFrames={120}
    />
    <Composition
      id="ProductUgcSpike"
      component={ProductUgcSpike}
      fps={30}
      width={720}
      height={1280}
      durationInFrames={PRODUCT_UGC_SPIKE_DURATION}
    />
    </>
  );
};
