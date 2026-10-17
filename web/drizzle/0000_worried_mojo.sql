CREATE TABLE "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"logo_url" text,
	"primary_color" text,
	"secondary_color" text,
	"font_family" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"identity" text,
	"tone_of_voice" text,
	"target_segments" jsonb,
	"extracted_colors" jsonb,
	"last_analyzed_at" timestamp,
	"slot_values" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remixed_script_id" uuid NOT NULL,
	"brand_profile_id" uuid,
	"batch_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" integer,
	"format" text DEFAULT 'slideshow' NOT NULL,
	"rendered_file_url" text,
	"rendered_at" timestamp,
	"talking_head_avatar_id" text,
	"talking_head_voice_id" text,
	"talking_head_video_id" text,
	"talking_head_video_url" text,
	"talking_head_status" text,
	"talking_head_failure_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_profile_id" uuid NOT NULL,
	"external_id" text,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"product_type" text,
	"description" text,
	"image_url" text,
	"price" text,
	"source_url" text NOT NULL,
	"slot_values" jsonb,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
CREATE TABLE "remix_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_profile_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"product_id" uuid,
	"subject_label" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"candidates_found" integer,
	"created_count" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "remixed_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trend_item_id" uuid NOT NULL,
	"brand_profile_id" uuid,
	"angle" text,
	"hook_type" text,
	"hook" text,
	"arc" text,
	"cta" text,
	"slides" jsonb,
	"beats" jsonb,
	"caption" text,
	"tags" jsonb,
	"hashtags" jsonb,
	"language" text DEFAULT 'english' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_profile_id" uuid,
	"source_url" text NOT NULL,
	"platform" text NOT NULL,
	"title" text,
	"handle" text,
	"caption" text,
	"hashtags" jsonb,
	"audio_track_name" text,
	"audio_id" text,
	"thumbnail_url" text,
	"posted_at" timestamp,
	"duration_seconds" real,
	"is_talking_head" boolean DEFAULT false,
	"unscored" boolean DEFAULT false,
	"view_count" integer,
	"like_count" integer,
	"comment_count" integer,
	"prev_view_count" integer,
	"prev_scraped_at" timestamp,
	"relevance_score" integer,
	"virality_score" integer,
	"final_score" integer,
	"extracted_hook" text,
	"extracted_arc" text,
	"extracted_beats" jsonb,
	"hook_line" text,
	"matched_skeletons" jsonb,
	"source_video_url" text,
	"source_video_downloaded_at" timestamp,
	"remix_count" integer DEFAULT 0 NOT NULL,
	"last_remixed_at" timestamp,
	"caption_position" text,
	"caption_size" text,
	"caption_style_checked_at" timestamp,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ready_for_remix" boolean DEFAULT false NOT NULL,
	"ready_marked_at" timestamp,
	"artifacts" jsonb DEFAULT '[]'::jsonb,
	CONSTRAINT "trend_items_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_remixed_script_id_remixed_scripts_id_fk" FOREIGN KEY ("remixed_script_id") REFERENCES "public"."remixed_scripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_batch_id_remix_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."remix_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remix_batches" ADD CONSTRAINT "remix_batches_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remix_batches" ADD CONSTRAINT "remix_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remixed_scripts" ADD CONSTRAINT "remixed_scripts_trend_item_id_trend_items_id_fk" FOREIGN KEY ("trend_item_id") REFERENCES "public"."trend_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remixed_scripts" ADD CONSTRAINT "remixed_scripts_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_items" ADD CONSTRAINT "trend_items_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE no action ON UPDATE no action;