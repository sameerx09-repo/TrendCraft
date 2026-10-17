import type { Brief, Product } from "./types";
export interface PreviewScene {
  id: string;
  label: string;
  type: "image" | "video";
  src: string;
  caption: string;
  seconds: number;
}
export interface PreviewConcept {
  id: string;
  title: string;
  format: "persona" | "product";
  rationale: string;
  personaId?: string;
  scenes: PreviewScene[];
  approvedAt?: string;
  postId?: string;
}
export interface PreviewPilot {
  postId: string;
  conceptId: string;
  approvalId: string;
  authorizedAt: string;
  credits: number;
  prompt: string;
  sourceImageUrl: string;
  state: "queued" | "rendering" | "complete" | "failed";
  providerTaskId?: string;
  error?: string;
}
export interface PreviewPlan {
  id: string;
  inputHash: string;
  input: {
    brief: Brief;
    directions: string[];
    product: Product;
    brandName: string;
  };
  createdAt: string;
  copySource: "catalog" | "ai";
  reference?: { src: string; sha256: string };
  concepts: PreviewConcept[];
  pilot?: PreviewPilot;
}
