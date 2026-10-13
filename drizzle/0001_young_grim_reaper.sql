-- Hand-ordered after `pnpm db:generate`: search_text must exist before the generated column
-- reads it, and dropping `search` drops its GIN index, so it is recreated at the end.
ALTER TABLE "archive_entries" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "archive_entries" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(title || ' ' || coalesce(source_url, '') || ' ' || left(coalesce(search_text, ''), 200000), '[^[:alnum:]]+', ' ', 'g'))) STORED;--> statement-breakpoint
CREATE INDEX "archive_entries_search_idx" ON "archive_entries" USING gin ("search");
