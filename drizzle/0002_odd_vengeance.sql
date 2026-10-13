CREATE TABLE "archive_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"input" jsonb NOT NULL,
	"source_url" text,
	"title" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text,
	"progress" real,
	"detail" text,
	"log_tail" text DEFAULT '' NOT NULL,
	"error" text,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "archive_jobs" ADD CONSTRAINT "archive_jobs_entry_id_archive_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."archive_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_jobs_status_idx" ON "archive_jobs" USING btree ("status","queued_at");