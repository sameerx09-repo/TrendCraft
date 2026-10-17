import "server-only";
import { isMockMode } from "@/lib/clients/mockMode";
import { TEST_INSTAGRAM_URL } from "./media-policy";
import type { EngagementPublishingStatus } from "./media-types";

export function engagementPublishingStatus(): EngagementPublishingStatus {
  const mockMode = isMockMode();
  // No brand OAuth credentials or publishing integration exist in this build.
  // Do not infer a connected account from a handle or pasted post URL.
  return {
    mockMode,
    instagramConnected: false,
    canProceed: mockMode,
    error: mockMode
      ? null
      : "Cannot proceed: your brand's Instagram account is not connected. Instagram connection and publishing are not available in this build.",
    testReelUrl: mockMode ? TEST_INSTAGRAM_URL : null,
  };
}
