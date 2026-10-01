-- no-transaction
-- Support per-inbox ordering and cursor scans for returned reminders.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_inbox_reminder_sort
    ON email_threads (link_id, (GREATEST(latest_inbound_message_ts, reminder_returned_at)) DESC, id DESC)
    WHERE inbox_visible = TRUE;
