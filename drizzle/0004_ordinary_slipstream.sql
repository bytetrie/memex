CREATE TABLE "memex_assets" (
	"sha256" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "memex_page_assets" (
	"page_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	CONSTRAINT "memex_page_assets_page_id_sha256_pk" PRIMARY KEY("page_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "memex_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"doc" jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(title || ' ' || left(text, 200000), '[^[:alnum:]]+', ' ', 'g'))) STORED
);
--> statement-breakpoint
CREATE TABLE "memex_tags" (
	"page_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "memex_tags_page_id_tag_pk" PRIMARY KEY("page_id","tag")
);
--> statement-breakpoint
ALTER TABLE "memex_page_assets" ADD CONSTRAINT "memex_page_assets_page_id_memex_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."memex_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memex_page_assets" ADD CONSTRAINT "memex_page_assets_sha256_memex_assets_sha256_fk" FOREIGN KEY ("sha256") REFERENCES "public"."memex_assets"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memex_tags" ADD CONSTRAINT "memex_tags_page_id_memex_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."memex_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memex_page_assets_sha256_idx" ON "memex_page_assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "memex_pages_search_idx" ON "memex_pages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "memex_pages_updated_idx" ON "memex_pages" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memex_tags_tag_idx" ON "memex_tags" USING btree ("tag");