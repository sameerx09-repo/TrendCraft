import type { BeatRole } from "./runwayPromptTemplates";

/**
 * Rhetorical skeletons mined from a real 311-reel corpus, scraped via
 * apify/instagram-search-scraper in `popular` mode across the advice/hack
 * keyword family (see scripts/harvestAdviceHooks.ts).
 *
 * WHY THIS FILE IS A CURATED ASSET, NOT A MODEL OUTPUT
 * ----------------------------------------------------
 * Instagram indexes topics, not formats. Verified four independent ways
 * against the live platform: #greenscreen returns zero results; the phrase
 * "tell me your most delusional" returns zero; /popular/relatable,
 * /popular/pov and /popular/confession all return "Empty or private data";
 * and every hashtag real creators actually used in the corpus was topical
 * (#lifehack, #beauty) rather than compositional. There is no query that
 * finds "a format". So skeletons cannot be searched for — they have to be
 * read out of a harvested corpus and written down. This file is that written
 * record, and it compounds: each harvest adds instances to known skeletons or
 * reveals a new one.
 *
 * WHY THE PLAY COUNTS ARE RECORDED
 * --------------------------------
 * `instances`/`creators` matter more than raw plays. A skeleton used 14 times
 * by 10 different creators has been independently reinvented, which is the
 * actual evidence that it travels across niches. `independenceRatio`
 * (creators/instances) makes that explicit — 1.0 means every single use was a
 * different creator. By that measure `wish_i_knew` is the most portable
 * skeleton we have despite having ~6x fewer plays than `authority_secret`.
 *
 * BEAT SHAPE — CORRECTED
 * -----------------------
 * An earlier version of this file gave every skeleton a wordless middle
 * "proof" beat (a silent product demo), reasoning from the hack-reel corpus
 * (@kriss.perfect_mom, @felykdimon) where that pattern really does appear.
 * That was the wrong reference format. The actual competitor implementation
 * (usefastlane.ai, inspected directly via two screen recordings) never shows
 * product, skin, or touch in ANY example — five separate remixes checked
 * frame-by-frame, all five just a person on screen with a wall of text doing
 * 100% of the persuasive work. This matches the ORIGINAL finding from this
 * same research ("remixability ≈ visual neutrality" — the visual carries no
 * semantic load, the text carries all of it) that got abandoned when the
 * hack-reel corpus was mined for skeletons.
 *
 * So: three text beats over persona footage, no product beat, no demo beat.
 * This also means the whole product-in-hand / skin-contact generation
 * problem (6 real Runway failures, still unsolved) is simply not in scope
 * for THIS format — it doesn't need that shot at all. A real product photo
 * can still appear as a static end card after the button beat (no motion, no
 * AI), but that is optional polish, not a pipeline requirement.
 */

export type SkeletonId =
  | "authority_secret"
  | "wish_i_knew"
  | "skeptic_disarm"
  | "saves_money"
  | "did_you_know";

export interface SkeletonEvidence {
  instances: number;
  totalPlays: number;
  creators: number;
  /** creators / instances. 1.0 = every use was an independent creator. */
  independenceRatio: number;
  /** Real hook lines from the corpus, verbatim. */
  examples: string[];
}

export interface SkeletonBeat {
  role: BeatRole;
  /** Slot placeholders in {braces}. Always text — see BEAT SHAPE above for
   * why there is no wordless beat in this library. */
  template: string;
}

export interface Skeleton {
  id: SkeletonId;
  name: string;
  slots: string[];
  /** Detects further instances of this skeleton in newly harvested hooks. */
  match: RegExp;
  evidence: SkeletonEvidence;
  beats: SkeletonBeat[];
}

export const SKELETONS: Record<SkeletonId, Skeleton> = {
  authority_secret: {
    id: "authority_secret",
    name: "[authority] told/taught me this [secret]",
    slots: ["authority", "payoff", "product"],
    match: /\b(told|taught)\s+me\b|\b(housekeeper|maid)\W*s?\s+(cleaning\s+)?(secret|trick|hack)\b/i,
    evidence: {
      instances: 14,
      totalPlays: 416_528_925,
      creators: 10,
      independenceRatio: 0.71,
      examples: [
        "The Hotel cleaning maid taught me this cleaning secret", // 141.1M @sana.motherhood
        "Life hack 2025, My grandma taught me this.", // 64.2M @teo_fatherhood
        "A perfumer told me this - and it changed everything", // 45.0M @kriss.perfect_mom
        "A perfumer taught me this hack", // 27.1M @felykdimon
        "My make-up artist told me this secret", // 21.5M @awesome_motherhood
      ],
    },
    beats: [
      { role: "setup", template: "{authority} told me this — and it changed everything" },
      { role: "reveal", template: "{payoff}" },
      { role: "button", template: "{product}. Link in bio." },
    ],
  },

  wish_i_knew: {
    id: "wish_i_knew",
    name: "I wish I knew this / can't believe I just learned this",
    slots: ["thing", "age", "payoff"],
    match: /\bi wish i (knew|had known)\b|\bi (just |only )?learned th\w+\b|\bcan.?t believe i\b/i,
    evidence: {
      instances: 9,
      totalPlays: 71_131_474,
      creators: 9,
      independenceRatio: 1.0, // highest portability signal in the corpus
      examples: [
        "I wish I knew this beauty hack before", // 19.3M @nataliia.sahm
        "I cant believe I just learned this at 33", // 16.9M @wow_motherhood
        "I cant believe I didnt know this sooner", // 12.8M @rezeda.tips
        "5 HAIR TIPS I WISH I KNEW EARLIER!!!", // 2.4M @alenayuann
      ],
    },
    beats: [
      { role: "setup", template: "I can't believe I only learned this at {age}" },
      { role: "reveal", template: "{payoff}" },
      { role: "button", template: "{thing}. Link in bio." },
    ],
  },

  skeptic_disarm: {
    id: "skeptic_disarm",
    name: "looks weird / judge me — but it works",
    slots: ["objection", "payoff", "product"],
    match: /\blooks?\s+(weird|strange|crazy|gross)\b|\bjudge me\b|\bdon.?t judge\b/i,
    evidence: {
      instances: 2,
      totalPlays: 81_600_234,
      creators: 2,
      independenceRatio: 1.0,
      examples: [
        "Judge me or not, Im still using this hack", // 59.0M @chicandrise
        "Looks weird, but it actually works wonders!", // 22.6M @lucylupinievlogs
      ],
    },
    beats: [
      // Was `{objection} — but I'm still doing it every night` — an em-dash
      // continuation only reads correctly when {objection} is a bare
      // statement. Real generated objections come back as full questions
      // too (e.g. "Does one product really handle sun, pollution, AND blue
      // light?"), and grafting a dash onto a question mark produced
      // "...blue light? — but I'm still doing it every night", confirmed
      // live in the first real run of remixSkeletonMatchedItems. A period
      // reads correctly for either shape.
      { role: "setup", template: "{objection} I'm still doing it every night." },
      { role: "reveal", template: "{payoff}" },
      { role: "button", template: "{product}. Link in bio." },
    ],
  },

  saves_money: {
    id: "saves_money",
    name: "this is what saves you money/time",
    slots: ["payoff", "product"],
    match: /\bsaves? (you )?(a lot of )?(money|time)\b|\bsave money\b/i,
    evidence: {
      instances: 6,
      totalPlays: 138_111_066,
      creators: 4,
      independenceRatio: 0.67,
      examples: [
        "This is what saves you money.", // 51.5M @kriss.perfect_mom
        "These cleaning hacks will save you time and money!", // 21.5M @creative_explained
        "Save money doing this genius idea", // 20.9M @meche530
      ],
    },
    beats: [
      { role: "setup", template: "This is what saved my skin — and my money" },
      { role: "reveal", template: "{payoff}" },
      { role: "button", template: "{product}. Link in bio." },
    ],
  },

  did_you_know: {
    id: "did_you_know",
    name: "did you know this?",
    slots: ["fact", "payoff", "product"],
    match: /\bdid you know\b/i,
    evidence: {
      instances: 2,
      totalPlays: 80_739_423,
      creators: 2,
      independenceRatio: 1.0,
      examples: [
        "Did you know this hack? What do you think about it?", // 70.8M @hacksbyviktoriia
        "Did you know a girl who couldn't stop applying Vaseline?", // 9.9M @mysteryvault_0
      ],
    },
    beats: [
      // Was `Did you know this about {fact}?` — assumed {fact} would be a
      // short noun phrase. Every real fact generated by the copywriter is a
      // full sentence (e.g. "Kumkumadi is an ancient Ayurvedic blend..."),
      // so "about {fact}?" produced "Did you know this about It's 3-in-1:
      // a daily moisturizer...one step.?" — confirmed live in the first
      // real comparison-view build. Same root cause as the skeptic_disarm
      // fix above: the template assumed a grammatical shape the copywriter
      // never actually produces. Two standalone sentences work for either
      // shape.
      { role: "setup", template: "Did you know? {fact}" },
      { role: "reveal", template: "{payoff}" },
      { role: "button", template: "{product}. Link in bio." },
    ],
  },
};

/** Fills a skeleton's beats with brand-specific slot values. Unfilled slots
 * are left visible as {slot} rather than silently blanked, so a missing value
 * shows up in review instead of shipping as a hole in the copy. */
export function fillSkeleton(
  id: SkeletonId,
  values: Record<string, string>
): { role: BeatRole; caption: string }[] {
  return SKELETONS[id].beats.map((beat) => ({
    role: beat.role,
    caption: beat.template.replace(/\{(\w+)\}/g, (whole, slot) => values[slot] ?? whole),
  }));
}

/** Classifies a freshly harvested hook line against the library. Returns every
 * matching skeleton — hooks can legitimately carry two (e.g. an authority
 * attribution that also promises savings). */
export function matchSkeletons(hook: string): SkeletonId[] {
  return (Object.keys(SKELETONS) as SkeletonId[]).filter((id) => SKELETONS[id].match.test(hook));
}

/**
 * Spreads a skeleton's beats across however many real clips exist — for
 * the artifact-remix path, where clip count = uploaded-artifact count, not
 * always exactly 3. Only the FIRST beat ("setup") is ever a generic,
 * brand-agnostic hook by design — "reveal" and "button" are the only two
 * lines that ever mention the actual product/brand (see each skeleton's
 * beats above). Confirmed live this was a real gap: with fewer clips than
 * beats, a naive beats[i] mapping silently drops trailing beats, so a
 * single-artifact remix showed ONLY the hook and never mentioned the
 * brand at all.
 *
 * Returns one GROUP (array of beat strings) per clip, not a pre-joined
 * string — prepareArtifactClip (lib/render/artifactMedia.ts) plays a
 * group's lines one at a time in sequence over that clip's own duration.
 * Showing every grouped line simultaneously, stacked as one static block,
 * was confirmed live to read as an incoherent run-on (a punchy hook
 * immediately followed by unrelated ad copy, no separation) — sequencing
 * them is what an actual single-video ad looks like instead.
 *
 * When clipCount >= beats.length, cycles through in order (e.g. 5 clips,
 * 3 beats -> 0,1,2,0,1, one beat per clip). When clipCount < beats.length,
 * groups beats onto the available clips as evenly as possible, in order,
 * so every beat still appears somewhere (e.g. 1 clip -> all 3 beats
 * played in sequence on that one clip; 2 clips -> [beat0], [beat1,beat2]).
 */
export function distributeBeatsAcrossClips(beats: string[], clipCount: number): string[][] {
  if (clipCount <= 0 || beats.length === 0) return [];
  if (clipCount >= beats.length) {
    return Array.from({ length: clipCount }, (_, i) => [beats[i % beats.length]]);
  }
  const grouped: string[][] = [];
  let cursor = 0;
  for (let c = 0; c < clipCount; c++) {
    const remainingClips = clipCount - c;
    const take = Math.ceil((beats.length - cursor) / remainingClips);
    grouped.push(beats.slice(cursor, cursor + take));
    cursor += take;
  }
  return grouped;
}
