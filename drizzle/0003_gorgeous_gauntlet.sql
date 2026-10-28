CREATE TABLE "notes_blocks" (
	"page_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "notes_blocks_page_id_block_id_pk" PRIMARY KEY("page_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "notes_drawings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scene" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notes_links" (
	"from_page_id" uuid NOT NULL,
	"from_block_id" text,
	"to_page_id" uuid NOT NULL,
	"to_block_id" text
);
--> statement-breakpoint
CREATE TABLE "notes_page_drawings" (
	"page_id" uuid NOT NULL,
	"drawing_id" uuid NOT NULL,
	CONSTRAINT "notes_page_drawings_page_id_drawing_id_pk" PRIMARY KEY("page_id","drawing_id")
);
--> statement-breakpoint
CREATE TABLE "notes_pages" (
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
CREATE TABLE "notes_tags" (
	"page_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "notes_tags_page_id_tag_pk" PRIMARY KEY("page_id","tag")
);
--> statement-breakpoint
ALTER TABLE "notes_blocks" ADD CONSTRAINT "notes_blocks_page_id_notes_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notes_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_links" ADD CONSTRAINT "notes_links_from_page_id_notes_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."notes_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_page_drawings" ADD CONSTRAINT "notes_page_drawings_page_id_notes_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notes_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_page_drawings" ADD CONSTRAINT "notes_page_drawings_drawing_id_notes_drawings_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."notes_drawings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_tags" ADD CONSTRAINT "notes_tags_page_id_notes_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notes_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_links_from_idx" ON "notes_links" USING btree ("from_page_id");--> statement-breakpoint
CREATE INDEX "notes_links_to_idx" ON "notes_links" USING btree ("to_page_id");--> statement-breakpoint
CREATE INDEX "notes_page_drawings_drawing_idx" ON "notes_page_drawings" USING btree ("drawing_id");--> statement-breakpoint
CREATE INDEX "notes_pages_search_idx" ON "notes_pages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "notes_pages_updated_idx" ON "notes_pages" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_tags_tag_idx" ON "notes_tags" USING btree ("tag");