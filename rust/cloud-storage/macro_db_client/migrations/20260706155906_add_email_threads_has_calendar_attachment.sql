-- Denormalized "thread has a calendar attachment" flag for the CalendarOnly
-- soup filter. Deriving it at query time joins email_attachments against
-- email_messages (hundreds of thousands of rows per link) on every page load.
-- Maintained at attachment ingest and message delete (email_db_client);
-- existing threads are flagged by the backfill_calendar_flags util in
-- email_service.
ALTER TABLE email_threads
    ADD COLUMN IF NOT EXISTS has_calendar_attachment boolean NOT NULL DEFAULT false;

-- Superseded by idx_email_threads_calendar_view (next migration), which adds
-- the sort key. CREATE INDEX CONCURRENTLY can't run in a transaction, so it
-- lives in its own no-transaction migration.
DROP INDEX IF EXISTS idx_email_threads_calendar_link_id;
