import {
  uniqueIndex,
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";

/** Brand workspaces. auth_users binds each account to its workspace; all request-time access is scoped to that membership. */
export const brandProfiles = pgTable("brand_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  fontFamily: text("font_family"),
  /** Tracked hashtags for Trend Feed discovery (trendcraft_implementation_plan.md
   * section 8: "Hashtags pulled from brand_profiles.hashtags"). Never existed
   * as a real column until now — the Phase 0 proof route hardcoded them inline. */
  hashtags: jsonb("hashtags").$type<string[]>().default([]),
  // Real site analysis (POST /api/brand/analyze) — identity/toneOfVoice/
  // targetSegments come from an AI read of the homepage; extractedColors
  // from a real frequency scan of the site's own linked CSS. Separate from
  // primaryColor/secondaryColor (still the two colors that actually drive
  // rendering, see lib/inngest/functions.ts) — these are informational,
  // shown as reference swatches, not wired into render output.
  identity: text("identity"),
  toneOfVoice: text("tone_of_voice"),
  targetSegments: jsonb("target_segments").$type<string[]>(),
  extractedColors: jsonb("extracted_colors").$type<string[]>(),
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  /** Brand-level skeleton slot values (payoff/fact/objection/thing), same
   * shape as products.slotValues — generated once from identity/toneOfVoice
   * (not a specific product) and cached here, for the "remix my brand in
   * general" flow where there's no product to ground the copy in. */
  slotValues: jsonb("slot_values").$type<{
    payoff: string;
    fact: string;
    objection: string;
    thing: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Permanent, append-only library (refresh upserts on source_url, never
 * deletes) — this is what powers velocity tracking via prev_view_count /
 * prev_scraped_at (needs_deep_dive.md C4) and the Content Library screen's
 * "Used xN" badge (D4). remixCount/lastRemixedAt are maintained counters
 * rather than a live join so the Content Library list stays a single query.
 */
export const trendItems = pgTable(
  "trend_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandProfileId: uuid("brand_profile_id").references(() => brandProfiles.id),
    sourceUrl: text("source_url").notNull(),
    platform: text("platform", {
      enum: ["instagram", "youtube", "local_upload", "manual_viral"],
    }).notNull(),
    title: text("title"),
    handle: text("handle"),
    caption: text("caption"),
    hashtags: jsonb("hashtags").$type<string[]>(),
    audioTrackName: text("audio_track_name"),
    audioId: text("audio_id"),
    /** Apify's own `displayUrl` cover-frame image, captured at scrape time.
     * Signed CDN URL — same expiry caveat as sourceVideoUrl (days, not
     * permanent), so this is a best-effort preview, not a durable asset. */
    thumbnailUrl: text("thumbnail_url"),
    /** The reel's real Instagram/YouTube post date (Apify's `timestamp`) —
     * distinct from scrapedAt (when WE pulled it). Powers the "Recent" sort;
     * scrapedAt alone only reflects when a harvest script happened to run,
     * not when the content was actually posted. */
    postedAt: timestamp("posted_at"),
    durationSeconds: real("duration_seconds"),
    isTalkingHead: boolean("is_talking_head").default(false),
    unscored: boolean("unscored").default(false),

    viewCount: integer("view_count"),
    likeCount: integer("like_count"),
    commentCount: integer("comment_count"),
    prevViewCount: integer("prev_view_count"),
    prevScrapedAt: timestamp("prev_scraped_at"),

    relevanceScore: integer("relevance_score"),
    viralityScore: integer("virality_score"),
    finalScore: integer("final_score"),

    extractedHook: text("extracted_hook"),
    extractedArc: text("extracted_arc"),
    extractedBeats: jsonb("extracted_beats").$type<string[]>(),

    /**
     * The reel's own hook line — caption text before the first hashtag
     * (lib/discovery/extractHook.ts). Distinct from extractedHook above, which
     * is the *remix-facing* hook produced by the scoring/remix pass. This is
     * the raw source hook, kept so skeleton matching can be re-run against the
     * whole library later without re-scraping. See CROSS_NICHE_DISCOVERY.md §5.
     */
    hookLine: text("hook_line"),
    /** SkeletonId[] from lib/render/skeletonLibrary.ts. Empty array means the
     * hook was read but matched nothing — meaningfully different from null,
     * which means it was never checked. */
    matchedSkeletons: jsonb("matched_skeletons").$type<string[]>(),

    /**
     * A locally-stored copy of the real source video, for the original-vs-
     * remix comparison view. Not the same thing as sourceUrl (the permanent
     * Instagram permalink) — Instagram's CDN video links expire within days,
     * so there is no way to embed-and-play the original without downloading
     * it once and storing our own copy (via lib/storage.ts's put(), same
     * mechanism already used for rendered remixes). Null until
     * downloadOriginalVideosForComparison runs for this item — real per-video
     * Apify spend, so this is deliberately on-demand, not automatic on scrape.
     */
    sourceVideoUrl: text("source_video_url"),
    sourceVideoDownloadedAt: timestamp("source_video_downloaded_at"),
    /**
     * Whether the row above came from MOCK_MODE (a random local fixture, not
     * this item's real reel) or a genuine Apify fetch. Needed because the
     * fetch-original route's idempotency guard — skip re-downloading once
     * sourceVideoUrl is set, to avoid double-spending ~$0.075/reel — was
     * confirmed live to also permanently block a real fetch for any item
     * that happened to be fetched once under mock mode: switching to live
     * mode later and retrying just hit the same short-circuit and returned
     * the stale mock data forever, with no way to ever get the real video/
     * caption for that item again. Defaults true since every fetch before
     * this flag existed happened during mock-mode dev testing.
     */
    sourceVideoIsMock: boolean("source_video_is_mock").default(true),

    remixCount: integer("remix_count").default(0).notNull(),
    lastRemixedAt: timestamp("last_remixed_at"),

    /**
     * Where/how big THIS specific reel's own on-screen caption actually is —
     * read directly off its thumbnail by a vision call
     * (lib/clients/captionStyleAnalyzer.ts), not guessed. Every remix used to
     * render its caption at one fixed position/size regardless of which
     * source reel it came from, which was the real thing behind "text
     * placement is really lacking" — a remix of a reel whose hook sits
     * center-screen in huge text still came out with our one generic
     * top-anchored medium size. Null until analyzed (lazily, only for reels
     * actually used in a remix — see remixSkeletonMatchedItems); a non-null
     * captionStyleCheckedAt with null position/size means the call ran but
     * found no clear caption to read (a real, distinct outcome from "never
     * checked" — don't keep re-billing it).
     */
    captionPosition: text("caption_position", {
      enum: ["top", "middle", "bottom"],
    }),
    captionSize: text("caption_size", {
      enum: ["small", "medium", "large", "huge"],
    }),
    /** Whether THIS reel's real caption sits on a solid box (the common
     * white-box-black-text meme convention) rather than plain text over the
     * video — confirmed live a remix looked visibly wrong/thin next to its
     * real source specifically because this was never captured at all; only
     * position/size were. Same null-until-analyzed, cached-only-on-success
     * semantics as captionPosition/captionSize above. */
    captionHasBackground: boolean("caption_has_background"),
    captionStyleCheckedAt: timestamp("caption_style_checked_at"),

    scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),

    /**
     * Manual-sourcing workflow (platform: "manual_viral") — since no
     * automated Apify path could deliver genuinely fresh+viral content (see
     * this session's investigation), an admin pastes in a real viral reel
     * link by hand instead. readyForRemix gates whether it's eligible as a
     * remix candidate at all (enforced in remixSkeletonMatchedItems's
     * candidate query, not just trusted to the UI) — a reel stays excluded
     * until an admin has sourced its visual artifacts and explicitly flips
     * this, independent of how many artifacts are uploaded.
     */
    readyForRemix: boolean("ready_for_remix").default(false).notNull(),
    readyMarkedAt: timestamp("ready_marked_at"),
    /** The manually-sourced visual ingredients a remix of this reel needs
     * (e.g. "reaction subject photo", "fire background clip") — a jsonb list
     * rather than a join table, same convention as hashtags/matchedSkeletons/
     * extractedBeats above, since nothing here needs relational querying
     * across artifacts. */
    artifacts: jsonb("artifacts")
      .$type<
        {
          id: string;
          label: string;
          fileUrl: string | null;
          status: "needed" | "uploaded";
        }[]
      >()
      .default([]),
  },
  (table) => [
    uniqueIndex("trend_items_brand_source_unique").on(
      table.brandProfileId,
      table.sourceUrl,
    ),
  ],
);

/**
 * Real product catalog, ingested from the brand's own Shopify store
 * (lib/clients/productCatalog.ts) — see CROSS_NICHE_DISCOVERY.md's follow-up
 * on why the skeleton library's {product} slot had no real data source until
 * this: every remix before this table existed hardcoded a product name by
 * hand, and it turned out to name a product that doesn't exist ("Kumkumadi
 * Night Renewal Cream" — the real catalog has "Magnesium Night Renewal
 * Cream" and "Kumkumadi Glow Elixir" as two separate products).
 *
 * sourceUrl (the canonical Shopify product page, not the CDN image) is the
 * upsert target, same pattern as trend_items.sourceUrl — a re-sync updates
 * in place rather than duplicating.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandProfileId: uuid("brand_profile_id")
      .references(() => brandProfiles.id)
      .notNull(),
    externalId: text("external_id"), // Shopify's numeric product id, as text
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    productType: text("product_type"),
    /** body_html with tags stripped — real marketing copy, not a skeleton
     * slot value. Turning this into a caption-length payoff is a synthesis
     * task that needs a real model call (OPENROUTER_API_KEY is available for
     * this); slotValues below is deliberately null until that pass runs,
     * rather than faked from a text truncation. */
    description: text("description"),
    imageUrl: text("image_url"),
    price: text("price"), // Shopify returns this as a decimal string; keep as text, no money math here
    sourceUrl: text("source_url").notNull(),
    slotValues: jsonb("slot_values").$type<Record<string, string>>(),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("products_brand_source_unique").on(
      table.brandProfileId,
      table.sourceUrl,
    ),
  ],
);

/** One brand-adapted script per remix run against a trend_item. A single
 * trend_item can have many remixed_scripts over time (D4) — that's the
 * point of tracking remixCount above rather than assuming 1:1. */
export const remixedScripts = pgTable("remixed_scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: an AI UGC script (Generate AI UGC workflow) has no sourced
  // reel at all — it's a persona reading brand/product copy, not a remix
  // of anything. Every render-path read of trendItem already tolerates
  // this (`trendItem ? ... : { position: null, ... }`), confirmed by
  // reading generate-persona/route.ts before making this change.
  trendItemId: uuid("trend_item_id").references(() => trendItems.id),
  brandProfileId: uuid("brand_profile_id").references(() => brandProfiles.id),
  // Which persona was explicitly picked for an AI UGC script — null for a
  // Viral Trends remix, which instead seeds pickPersona(postId) randomly
  // at render time (see generate-persona/route.ts). Must be one of
  // personaLibrary.ts's PERSONAS ids (the ones with real clips), not just
  // any id in the display-only ALL_PERSONAS roster.
  personaId: text("persona_id"),
  angle: text("angle"),
  hookType: text("hook_type"),
  hook: text("hook"),
  arc: text("arc"),
  cta: text("cta"),
  slides: jsonb("slides").$type<string[]>(),
  beats: jsonb("beats").$type<string[]>(),
  caption: text("caption"),
  // NOT the same thing as hashtags — this holds ad-hoc labels (real
  // hashtags from the mock/fixture path, or just [product.title] for
  // skeleton-matched posts, used to render the product-name chip). Kept
  // as-is rather than reused, to avoid breaking the existing chip.
  tags: jsonb("tags").$type<string[]>(),
  // Real per-post hashtags, editable from the Review card's edit modal.
  // Defaults to the source trend item's real scraped hashtags the first
  // time a script is generated (see remixSkeletonMatchedItems).
  hashtags: jsonb("hashtags").$type<string[]>(),
  language: text("language", { enum: ["english", "hinglish"] })
    .default("english")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * One "Generate Content" run — the Generate Content page's unit of
 * history/retrieval, separate from the Remixes page's plain round-robin
 * trigger. subjectLabel is denormalized (product title or brand name) so
 * the history list never needs a join back to products/brandProfiles, and
 * survives a product being renamed/deleted later.
 */
export const remixBatches = pgTable("remix_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandProfileId: uuid("brand_profile_id")
    .references(() => brandProfiles.id)
    .notNull(),
  mode: text("mode", { enum: ["product", "brand"] }).notNull(),
  productId: uuid("product_id").references(() => products.id),
  subjectLabel: text("subject_label").notNull(),
  status: text("status", { enum: ["in_progress", "completed", "failed"] })
    .default("in_progress")
    .notNull(),
  candidatesFound: integer("candidates_found"),
  createdCount: integer("created_count"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

/** The review-queue / export unit. status starts 'pending' and moves to
 * 'kept' or 'discarded' (fixes the mockup's original bug where only a
 * kept-array + count existed, no real per-item status). */
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  remixedScriptId: uuid("remixed_script_id")
    .references(() => remixedScripts.id)
    .notNull(),
  brandProfileId: uuid("brand_profile_id").references(() => brandProfiles.id),
  /** Set only for posts created via the Generate Content page — legacy
   * "Remix from skeletons" (Remixes page) posts leave this null. */
  batchId: uuid("batch_id").references(() => remixBatches.id),
  status: text("status", { enum: ["pending", "kept", "discarded"] })
    .default("pending")
    .notNull(),
  score: integer("score"),
  format: text("format", {
    enum: ["slideshow", "talking_head", "runway_remix", "artifact_remix"],
  })
    .default("slideshow")
    .notNull(),

  renderedFileUrl: text("rendered_file_url"),
  renderedAt: timestamp("rendered_at"),

  talkingHeadAvatarId: text("talking_head_avatar_id"),
  talkingHeadVoiceId: text("talking_head_voice_id"),
  talkingHeadVideoId: text("talking_head_video_id"),
  talkingHeadVideoUrl: text("talking_head_video_url"),
  talkingHeadStatus: text("talking_head_status", {
    enum: ["not_started", "waiting", "processing", "completed", "failed"],
  }),
  talkingHeadFailureCode: text("talking_head_failure_code"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const authUsers = pgTable("auth_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  brandProfileId: uuid("brand_profile_id")
    .references(() => brandProfiles.id)
    .notNull()
    .unique(),
  role: text("role", { enum: ["owner", "brand"] })
    .notNull()
    .default("brand"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const authSessions = pgTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .references(() => authUsers.id, { onDelete: "cascade" })
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const authBootstrap = pgTable("auth_bootstrap", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  brandProfileId: uuid("brand_profile_id")
    .references(() => brandProfiles.id)
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
});
export const authAttempts = pgTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
