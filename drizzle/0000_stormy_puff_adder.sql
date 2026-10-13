CREATE TABLE "archive_blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(title || ' ' || coalesce(source_url, ''), '[^[:alnum:]]+', ' ', 'g'))) STORED
);
--> statement-breakpoint
CREATE TABLE "archive_files" (
	"entry_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_files_entry_id_name_pk" PRIMARY KEY("entry_id","name")
);
--> statement-breakpoint
CREATE TABLE "archive_refs" (
	"entry_id" uuid NOT NULL,
	"module" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_refs_entry_id_module_item_id_pk" PRIMARY KEY("entry_id","module","item_id")
);
--> statement-breakpoint
CREATE TABLE "archive_searches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "archive_searches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"query" text NOT NULL,
	"type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_tags" (
	"entry_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "archive_tags_entry_id_tag_pk" PRIMARY KEY("entry_id","tag")
);
--> statement-breakpoint
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_entry_id_archive_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."archive_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_sha256_archive_blobs_sha256_fk" FOREIGN KEY ("sha256") REFERENCES "public"."archive_blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_refs" ADD CONSTRAINT "archive_refs_entry_id_archive_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."archive_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_tags" ADD CONSTRAINT "archive_tags_entry_id_archive_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."archive_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_entries_search_idx" ON "archive_entries" USING gin ("search");--> statement-breakpoint
CREATE INDEX "archive_entries_type_idx" ON "archive_entries" USING btree ("type","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "archive_files_sha256_idx" ON "archive_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "archive_tags_tag_idx" ON "archive_tags" USING btree ("tag");