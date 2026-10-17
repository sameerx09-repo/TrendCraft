import type { PreviewPlan } from "./preview-types";
export type Engine = "remix" | "ugc" | "product";
export type WorkspaceTab =
  | "overview"
  | "brief"
  | "remix"
  | "ugc"
  | "product"
  | "review"
  | "activity"
  | "exports";
export interface Brief {
  name: string;
  productId: string;
  goal: string;
  audience: string;
  language: "english" | "hinglish";
  tone: string;
  message: string;
  preferences: string;
  creditCap: number;
}
export interface CreativeRecord {
  postId: string;
  engine: Engine;
  title: string;
  state: "draft" | "queued" | "rendering" | "complete" | "failed" | "changes";
  previewPlanId?: string;
  previewConceptId?: string;
  agentPilot?: boolean;
  error?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Activity {
  id: string;
  message: string;
  detail: string;
  createdAt: string;
}
export interface Campaign {
  id: string;
  brief: Brief;
  paused: boolean;
  reservedCredits: number;
  previewPlan?: PreviewPlan;
  previewHistory?: PreviewPlan[];
  creatives: CreativeRecord[];
  activity: Activity[];
  directions: string[];
  createdAt: string;
}
export interface Product {
  id: string;
  title: string;
  imageUrl: string | null;
  description: string | null;
  productType: string | null;
}
export interface Trend {
  id: string;
  title: string | null;
  handle: string | null;
  caption: string | null;
  hookLine: string | null;
  sourceUrl: string;
  thumbnailUrl: string | null;
  readyForRemix: boolean;
  artifacts: { id: string; fileUrl: string | null; status: string }[] | null;
}
export interface Persona {
  id: string;
  label: string;
  anchorPhoto: string;
  setupVideo: string | null;
  buttonVideo: string | null;
}
export interface PostRow {
  post: {
    id: string;
    status: string;
    format: string;
    renderedFileUrl: string | null;
    createdAt: string;
    updatedAt: string;
  };
  script: {
    id: string;
    hook: string | null;
    hookType: string | null;
    personaId: string | null;
    arc: string | null;
    beats: string[] | null;
    caption: string | null;
    hashtags: string[] | null;
    tags: string[] | null;
    language: string;
  };
  trendItem: {
    id: string;
    platform: string;
    title: string | null;
    sourceUrl: string;
    thumbnailUrl: string | null;
  } | null;
}
export interface WorkspaceData {
  campaigns: Campaign[];
  posts: PostRow[];
  products: Product[];
  trends: Trend[];
  personas: Persona[];
  brand: { name: string; toneOfVoice: string | null; identity: string | null };
  mockMode: boolean;
}
export const ENGINES: Record<Engine, string> = {
  remix: "Remix Viral Trends",
  ugc: "Generate AI UGC",
  product: "Generate Product UGC",
};
export const EMPTY_BRIEF: Brief = {
  name: "",
  productId: "",
  goal: "",
  audience: "",
  language: "english",
  tone: "Warm and conversational",
  message: "",
  preferences: "Keep gestures subtle. Review packaging before export.",
  creditCap: 300,
};
export function engineOf(row: PostRow): Engine {
  if (
    row.script.hookType === "product_ad" ||
    row.script.hookType === "product_edit"
  )
    return "product";
  if (row.script.hookType === "brand_feed_remix") return "remix";
  if (row.script.hookType === "ai_ugc" || !row.trendItem) return "ugc";
  return "remix";
}
export function statusOf(row: PostRow, record?: CreativeRecord) {
  if (row.post.status === "discarded") return "Discarded";
  if (row.post.status === "kept") return "Kept";
  if (record?.state === "changes") return "Changes requested";
  if (row.post.renderedFileUrl) return "Needs review";
  if (record?.state === "failed") return "Render failed";
  if (record?.state === "queued" || record?.state === "rendering")
    return "In progress";

  return "Storyboard draft";
}
