-- Support per-inbox ordering and cursor scans for returned reminders.
CREATE INDEX idx_email_threads_inbox_reminder_sort
    ON email_threads (link_id, (GREATEST(latest_inbound_message_ts, reminder_returned_at)) DESC, id DESC)
    WHERE inbox_visible = TRUE;

-- Foreign-key cleanup must not scan the retained operation history.
CREATE INDEX idx_reminder_email_operation_reminder
    ON reminder_email_operation (reminder_id);
