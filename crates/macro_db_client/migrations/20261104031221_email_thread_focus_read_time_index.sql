-- no-transaction
-- One inbox's threads that join or leave Focus when it is read. With
-- email_thread_focus_list_idx this covers every way into the Focus list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_thread_focus_read_time_idx
    ON email_thread_focus (link_id)
    WHERE awaiting_reply OR calendar_hold_until IS NOT NULL;
