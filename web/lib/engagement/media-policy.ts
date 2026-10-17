import type { EngagementMedia } from "./media-types";
import type { Goal } from "./realPreview";

export const TEST_INSTAGRAM_URL =
  "https://www.instagram.com/reel/TEST_ONLY_TRENDCRAFT/";
export function isTestInstagramUrl(value: string) {
  return instagramPostUrl(value) === TEST_INSTAGRAM_URL;
}
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_MIME_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
export function instagramPostUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com"].includes(
        url.hostname.toLowerCase(),
      ) ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/(reel|p)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)
    )
      return null;
    return "https://www.instagram.com" + url.pathname.replace(/\/?$/, "/");
  } catch {
    return null;
  }
}
export function publicMediaBase(value?: string): string | null {
  try {
    if (!value) return null;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      /(^localhost$|\.localhost$|\.local$|\.internal$|\.test$|^\d+\.\d+\.\d+\.\d+$|:)/i.test(
        url.hostname,
      )
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function mediaTargetIssue(input: {
  goals: Goal[];
  reelUrl: string;
  media: EngagementMedia | null;
  publicMediaAvailable: boolean;
}): string | null {
  const url = input.reelUrl.trim();
  if (url && !instagramPostUrl(url))
    return "Enter a valid public Instagram reel or post link.";
  if (!input.media && !url)
    return "Choose a video or add its published Instagram link.";
  if (
    (input.goals.includes("engagement") || input.goals.includes("reach")) &&
    !url
  )
    return "A published Instagram link is required for likes, comments, tags and story shares.";
  if (input.goals.includes("ugc") && !url && !input.publicMediaAvailable)
    return "A published Instagram link or public video hosting is required for creator access.";
  return null;
}
