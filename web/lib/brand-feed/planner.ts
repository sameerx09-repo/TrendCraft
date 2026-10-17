import { createHash } from "node:crypto";
import type { FeedContext, FeedState, ReelSource, RemixIdea } from "./types";
import type { Product } from "../mission-control/types";

export function emptyFeed(tone = ""): FeedState {
  return {
    context: {
      direction: "",
      audience: "",
      tone: tone || "Warm and conversational",
      restrictions:
        "No medical claims, invented results, or fake customer testimonials.",
      language: "english",
      productId: "",
    },
    batch: 0,
    ideas: [],
    samples: [],
    sourceKinds: {},
  };
}
export function mediaType(src: string): "image" | "video" | "gif" {
  const extension = src.split("?")[0].split(".").pop()?.toLowerCase();
  return extension === "gif"
    ? "gif"
    : ["mp4", "webm", "mov"].includes(extension || "")
      ? "video"
      : "image";
}
export function isLocalMedia(src: string) {
  return /^\/storage\/(viral-trend-artifacts|source-videos)\/[a-zA-Z0-9_-]+\.(mp4|webm|mov|gif|png|jpg|jpeg|webp)$/i.test(
    src,
  );
}
export function ideaId(batch: number, source: string, context: FeedContext) {
  return createHash("sha256")
    .update(JSON.stringify([batch, source, context]))
    .digest("hex")
    .slice(0, 24);
}
function message(
  source: ReelSource,
  topic: string,
  alternate: boolean,
  hinglish: boolean,
) {
  const text = [source.title, source.caption].join(" ").toLowerCase();
  if (hinglish) {
    if (/bestie|friend/.test(text))
      return alternate
        ? "Main aur meri " + topic + " wali bestie."
        : "Jab bestie bhi " + topic + " mein interested ho.";
    if (/days|row|well|works/.test(text))
      return "Jab " + topic + " routine ke liye time mil jaye.";
    return alternate
      ? "Bas ek chhota sa " + topic + " moment."
      : "Main: sirf dekh rahi hoon. Also main:";
  }
  if (/bestie|friend/.test(text))
    return alternate
      ? "Me and the friend who gets my " + topic + " obsession."
      : "How my " + topic + " bestie accidentally came into my life.";
  if (/days|row|well|works/.test(text))
    return alternate
      ? "Me finding a little time for my " + topic + " routine."
      : "When I remember my " + topic + " routine three days in a row.";
  if (/important|message|share/.test(text))
    return "Sending this to the friend who gets my " + topic + " obsession.";
  if (/order|delivery|buy|shop/.test(text))
    return "Me when my " + topic + " order finally arrives.";
  return alternate
    ? "A little moment for my " + topic + " routine."
    : "Me: just browsing. Also me in the " + topic + " aisle:";
}
export function buildIdeas(input: {
  brandName: string;
  identity?: string | null;
  products: Product[];
  sources: ReelSource[];
  state: FeedState;
  now?: string;
}): RemixIdea[] {
  const { state, brandName } = input,
    now = input.now || new Date().toISOString();
  const context = state.context;
  const catalog = context.productId
    ? input.products.filter((p) => p.id === context.productId)
    : input.products;
  const skincare = /skin|cream|serum|lotion|beauty/i.test(
    [input.identity, ...catalog.map((p) => p.productType)].join(" "),
  );
  const topic = skincare ? "skincare" : "everyday";
  const direction = [context.direction, context.restrictions]
    .join(" ")
    .toLowerCase();
  const messageOnly =
    /message[- ]led only|no product (shots?|images?|display)|without (showing )?(the )?product/.test(
      direction,
    );
  const productOnly =
    /product[- ](led|focused) only|only product|product reels only/.test(
      direction,
    );
  const playful = /playful|funny|humou?r|casual/.test(
    context.tone + " " + direction,
  );
  const available = input.sources.filter(
    (s) => s.ready && s.kind !== "product" && s.media.length > 0,
  );
  const byKind = (["trend", "viral"] as const).flatMap((kind) => {
    const pool = available.filter((s) => s.kind === kind);
    if (!pool.length) return [];
    return [pool[state.batch % pool.length]];
  });
  if (byKind.length < 2 && available.length > byKind.length) {
    const rest = available.filter((s) => !byKind.some((x) => x.id === s.id));
    byKind.push(rest[state.batch % rest.length]);
  }
  const result: RemixIdea[] = (productOnly ? [] : byKind).map((source) => {
    const caption = message(
      source,
      topic,
      playful || state.batch % 2 === 1,
      context.language === "hinglish",
    );
    const sceneMedia = source.media.slice(0, 3);
    return {
      id: ideaId(state.batch, source.id, context),
      revision: 1,
      kind: source.kind,
      title: /bestie|friend/i.test(source.caption)
        ? "The friend who gets it"
        : /days|row/i.test(source.caption)
          ? "The routine reaction"
          : "A relatable " + topic + " moment",
      rationale:
        "A " +
        source.kind +
        " format with a brand-relevant message. The original visual carries the moment; no product shot is needed.",
      adaptation:
        "Keep the sourced visual and replace its message with a " +
        topic +
        " situation for " +
        brandName +
        ".",
      productId: context.productId || null,
      productName:
        catalog.find((p) => p.id === context.productId)?.title || null,
      source,
      scenes: sceneMedia.map((m) => ({
        src: m.src,
        type: m.type,
        caption,
        seconds: sceneMedia.length === 1 ? 6 : 4,
      })),
      caption: caption + " | " + brandName,
      decision: "new",
      createdAt: now,
    };
  });
  const product = catalog.filter((p) => p.imageUrl)[
    state.batch % Math.max(1, catalog.filter((p) => p.imageUrl).length)
  ];
  if (product?.imageUrl && !messageOnly) {
    const samples = input.sources.filter(
      (s) => s.kind === "product" && s.ready,
    );
    const reference = samples.length
      ? samples[state.batch % samples.length]
      : null;
    const lines =
      context.language === "hinglish"
        ? [
            "Apne routine ke liye ek pal.",
            product.title,
            brandName + " ko explore karein.",
          ]
        : [
            /night|evening/i.test(product.title)
              ? "A moment for your evening routine."
              : /sun|spf/i.test(product.title)
                ? "A moment for your morning routine."
                : "A little moment for your routine.",
            product.title,
            "Explore " + brandName + ".",
          ];
    result.push({
      id: ideaId(state.batch, "product:" + product.id, context),
      revision: 1,
      kind: "product",
      title: product.title + " in focus",
      rationale:
        "A product-led direction using your actual catalog image, balanced with the message-led ideas.",
      adaptation: reference
        ? "Reference: " +
          reference.title +
          ". This draft uses your actual packaging; it does not reuse the reference product or generate its motion."
        : "An original-image storyboard. Add a product reel reference to guide a future motion treatment.",
      productId: product.id,
      productName: product.title,
      source: reference,
      scenes: lines.map((caption) => ({
        src: product.imageUrl!,
        type: "image" as const,
        caption,
        seconds: 4,
      })),
      caption: lines.join(" "),
      decision: "new",
      createdAt: now,
    });
  }
  return result;
}
export function editIdea(idea: RemixIdea, revision: unknown, value: unknown) {
  if (idea.revision !== revision)
    throw new Error("This idea changed. Reload it before editing.");
  if (idea.job)
    throw new Error(
      "This version has entered production. Create a new batch to explore another version.",
    );
  if (
    !Array.isArray(value) ||
    value.length !== idea.scenes.length ||
    value.some(
      (v) => typeof v !== "string" || !v.trim() || v.trim().length > 200,
    )
  )
    throw new Error("Add a message of 1 to 200 characters for every scene.");
  idea.scenes.forEach((s, i) => {
    s.caption = (value[i] as string).trim();
  });
  idea.caption = idea.scenes.map((s) => s.caption).join(" ");
  idea.revision++;
}
