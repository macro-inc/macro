-- no-transaction

-- Partial index to speed up the `calendar_only` email filter.
-- Matches the EXISTS clause in dynamic/filters.rs build_thread_email_filter
-- for EmailLiteral::CalendarOnly(true):
--   filename ILIKE '%.ics' OR mime_type = 'text/calendar' OR mime_type = 'application/ics'.
-- Calendar attachments are sparse (~0.2% of rows), so a partial index is dramatically smaller
-- than indexing the full table and lets the planner cheaply check whether any message in a
-- thread carries an iCalendar attachment.
--
-- This index is typically created ahead of migration via:
--   CREATE INDEX CONCURRENTLY idx_email_attachments_calendar_message_id ...
-- so IF NOT EXISTS makes the migration a no-op when it catches up.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_attachments_calendar_message_id
    ON email_attachments (message_id)
    WHERE filename ILIKE '%.ics'
       OR mime_type = 'text/calendar'
       OR mime_type = 'application/ics';
