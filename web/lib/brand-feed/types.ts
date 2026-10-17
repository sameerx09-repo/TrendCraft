import type { Product } from "../mission-control/types";

export type ReelKind = "trend" | "viral" | "product";
export type IdeaDecision = "new" | "kept" | "skipped";
export interface ReelSource {
  id: string;
  kind: ReelKind;
  title: string;
  caption: string;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  media: { id: string; src: string; type: "image" | "video" | "gif" }[];
  ready: boolean;
  uploadedSample?: boolean;
}
export interface RemixScene {
  src: string;
  type: "image" | "video" | "gif";
  caption: string;
  seconds: number;
}
export interface RemixIdea {
  id: string;
  revision: number;
  kind: ReelKind;
  title: string;
  rationale: string;
  adaptation: string;
  productId: string | null;
  productName: string | null;
  source: ReelSource | null;
  scenes: RemixScene[];
  caption: string;
  decision: IdeaDecision;
  createdAt: string;
  job?: {
    postId: string;
    state: "queued" | "rendering" | "complete" | "failed";
    url?: string;
    error?: string;
    updatedAt: string;
  };
}
export interface FeedContext {
  direction: string;
  audience: string;
  tone: string;
  restrictions: string;
  language: "english" | "hinglish";
  productId: string;
}
export interface FeedState {
  context: FeedContext;
  batch: number;
  ideas: RemixIdea[];
  samples: ReelSource[];
  sourceKinds: Record<string, ReelKind>;
}
export interface FeedData {
  brand: { name: string; identity: string | null; toneOfVoice: string | null };
  products: Product[];
  sources: ReelSource[];
  feed: FeedState;
  mockMode: boolean;
}
