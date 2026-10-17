import { createHash, randomUUID } from "node:crypto";
import type { Brief, Product } from "./types";
import type { PersonaDisplayInfo } from "../render/personaLibrary";
import type { PreviewPlan, PreviewScene } from "./preview-types";

export function previewInputHash(
  brief: Brief,
  directions: string[],
  product: Product,
  brandName: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        brief,
        directions,
        product: {
          id: product.id,
          title: product.title,
          imageUrl: product.imageUrl,
          description: product.description,
        },
        brandName,
      }),
    )
    .digest("hex");
}
export function assertPreviewCurrent(
  plan: PreviewPlan | undefined,
  planId: unknown,
  hash: string,
  paused: boolean,
) {
  if (paused)
    throw new Error("Resume the campaign before producing a creative.");
  if (!plan || plan.id !== planId)
    throw new Error(
      "This preview has been replaced. Open the current preview.",
    );
  if (plan.inputHash !== hash)
    throw new Error(
      "The brief or product changed. Prepare a fresh preview before approving.",
    );
}
export function assertPreviewApproval(reviewed: unknown) {
  if (reviewed !== true)
    throw new Error(
      "Review the script, product image and pacing before approving.",
    );
}
export function buildPreviewPlan(input: {
  brief: Brief;
  directions: string[];
  product: Product;
  brandName: string;
  personas: PersonaDisplayInfo[];
  beats?: string[];
}): PreviewPlan {
  const { brief, directions, product, brandName } = input;
  if (!product.imageUrl)
    throw new Error("Add a product reference image before preparing previews.");
  const context = [brief.goal, brief.tone, brief.preferences, ...directions]
    .join(" ")
    .toLowerCase();
  const evening = /night|evening|bedtime/.test(
    context + " " + product.title.toLowerCase(),
  );
  const requestedPersona = input.personas.find((p) => context.includes(p.id));
  const persona =
    requestedPersona ||
    input.personas.find(
      (p) => p.id === (/work|office/.test(context) ? "ananya" : "meera"),
    ) ||
    input.personas[0];
  const safeClip = (clips: NonNullable<PersonaDisplayInfo["clips"]["setup"]>) =>
    clips.find((c) => !/point|hand|hair.?tuck|surpris|deadpan/i.test(c.label));
  const opening = persona && safeClip(persona.clips.setup || []);
  const closing = persona && (safeClip(persona.clips.button || []) || opening);
  const short = (value: string) => value.trim().slice(0, 200);
  const supplied = input.beats?.length === 3 ? input.beats.map(short) : null;
  const hinglish = brief.language === "hinglish";
  const hook =
    supplied?.[0] ||
    (/everyday|casual|simple/.test(context)
      ? hinglish
        ? "Routine ko simple rakhein."
        : "Keep your routine simple."
      : evening
        ? hinglish
          ? "Raat ke routine ke liye ek pal."
          : "Make room for your evening ritual."
        : hinglish
          ? "Apne routine ke liye ek chhota sa pal."
          : "A little moment for your routine.");
  const reveal = supplied?.[1] || product.title;
  const cta =
    supplied?.[2] ||
    (hinglish ? brandName + " ko explore karein." : "Explore " + brandName);
  const scene = (
    label: string,
    type: "image" | "video",
    src: string,
    caption: string,
    seconds = 4,
  ): PreviewScene => ({
    id: randomUUID(),
    label,
    type,
    src,
    caption: short(caption),
    seconds,
  });
  const concepts: PreviewPlan["concepts"] = [];
  if (persona && opening && closing)
    concepts.push({
      id: randomUUID(),
      title: evening ? "The evening ritual" : "The everyday ritual",
      format: "persona",
      personaId: persona.id,
      rationale:
        persona.label +
        " with subtle expression clips. A separate, original product image keeps packaging out of generated hands.",
      scenes: [
        scene(
          persona.label + " / Opening",
          "video",
          "/" + opening.videoSrc,
          hook,
          Math.min(4, opening.durationInFrames / 30),
        ),
        scene("Original product image", "image", product.imageUrl, reveal),
        scene(
          persona.label + " / Closing",
          "video",
          "/" + closing.videoSrc,
          cta,
          Math.min(4, closing.durationInFrames / 30),
        ),
      ],
    });
  concepts.push({
    id: randomUUID(),
    title: "Product in focus",
    format: "product",
    rationale:
      "A product-led edit using the original catalog image. No new packaging, gestures or generated claims.",
    scenes: [
      scene("Product / Introduction", "image", product.imageUrl, product.title),
      scene(
        "Product / Message",
        "image",
        product.imageUrl,
        supplied?.[0] || brief.message || hook,
      ),
      scene("Product / Closing", "image", product.imageUrl, cta),
    ],
  });
  return {
    id: randomUUID(),
    input: structuredClone({
      brief,
      directions,
      product: {
        id: product.id,
        title: product.title,
        imageUrl: product.imageUrl,
        description: product.description,
        productType: product.productType,
      },
      brandName,
    }),
    inputHash: previewInputHash(brief, directions, product, brandName),
    createdAt: new Date().toISOString(),
    copySource: supplied ? "ai" : "catalog",
    concepts,
  };
}
export const PILOT_CREDITS = 48;
export const PILOT_DIRECTION =
  "A restrained slow push-in on the supplied product. Keep the full label in frame. No hands, no people, no added text, no packaging redesign. Soft neutral studio light.";
