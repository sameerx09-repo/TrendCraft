export interface EngagementMedia {
  id: string;
  kind: "generated" | "uploaded";
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  label: string;
  reviewStatus: "kept" | "pending";
  publishedUrl: string;
  createdAt: string;
}

export interface EngagementMediaState {
  uploads: EngagementMedia[];
  publishedLinks: Record<string, string>;
}

export interface EngagementMediaLibrary {
  items: EngagementMedia[];
  publicMediaAvailable: boolean;
}

export interface EngagementPublishingStatus {
  mockMode: boolean;
  instagramConnected: boolean;
  canProceed: boolean;
  error: string | null;
  testReelUrl: string | null;
}
