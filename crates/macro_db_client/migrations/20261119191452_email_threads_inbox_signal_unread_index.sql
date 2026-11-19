-- no-transaction
-- The Important tab with its unread filter (the Mail view's unread facet and
-- navigation's Mail unread) walked each inbox's newest threads in
-- idx_email_threads_inbox_reminder_sort and read every thread row to test
-- is_signal and is_read. With fewer unread Important threads than its LIMIT,
-- that read the whole inbox: tens of thousands of rows for a large mailbox.
-- This index holds only the unread Important inbox threads, in the same
-- order, so the scan stops at the LIMIT or at the last of them.
-- Partial on unread Important inbox threads: a read thread leaves it.
-- is_read was in no index before, so an update that changes only is_read
-- among indexed columns can stop being HOT. Its writers also set
-- updated_at, which other indexes cover, unless NOW() equals the stored
-- value (a second write in one transaction). Under 2% of this table's
-- updates are HOT.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_email_threads_inbox_signal_unread;
CREATE INDEX CONCURRENTLY idx_email_threads_inbox_signal_unread
    ON email_threads (link_id, (GREATEST(latest_inbound_message_ts, reminder_returned_at)) DESC, id DESC)
    WHERE inbox_visible = TRUE AND is_signal AND is_read = FALSE;
