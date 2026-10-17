/**
 * The hook line is the caption text BEFORE the first hashtag.
 *
 * This is deliberately unglamorous, and it is the whole extraction step. Three
 * more expensive approaches were tested against real scraped reels first and
 * all lost to this one:
 *
 *  - Whole-caption n-gram clustering: found only grammatical filler ("i didn
 *    t", "one of the"). The hook was drowned by trailing hashtags and credits.
 *  - Audio transcript (apify/instagram-reel-scraper, includeTranscript, real
 *    spend): the highest-remixability reels have no speech at all — they are
 *    silent demos set to trending audio, so the transcriber faithfully
 *    returned the *song*. The 45M-play "A perfumer told me this" reel
 *    transcribed as "być panną"; the 27M-play one as "have fun".
 *  - Frame OCR/vision: works, but is redundant. @kriss.perfect_mom burns the
 *    hook into the video AND the caption; @felykdimon (same skeleton, 27M
 *    plays) has no on-screen text at all and lives only in the caption. So
 *    the caption is the more reliable channel, not the weaker one.
 *
 * Yield on the real corpus: 69/105 reels in the first batch, 140/189 in the
 * advice-family batch.
 */
export function extractHook(caption?: string | null): string {
  if (!caption) return "";
  return caption
    .split("#")[0]
    .replace(/@[\w.]+/g, " ") // @mentions are credits, not hook text
    // Emoji/pictographs + their variation-selector and ZWJ glue only — NOT a
    // blanket non-ASCII strip. The previous /[^\x20-\x7e]/ version deleted
    // every non-Latin script outright (confirmed live: a real Hindi caption,
    // "घर में कुत्ता पालने से क्या होता है", came out as just "|" — the
    // separator punctuation was ASCII, the actual hook text wasn't). Indian
    // creator content is a real, needed slice of this corpus, not an edge case.
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[‍️]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hooks outside this band are either bare topic labels ("Kitchen hack") or
 * full descriptive paragraphs — neither carries a reusable skeleton. */
export function isUsableHook(hook: string): boolean {
  return hook.length >= 12 && hook.length <= 130;
}
