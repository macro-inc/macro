-- no-transaction
-- One inbox's threads waiting on the other side. With
-- email_thread_focus_list_idx this covers both ways into the Focus list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_thread_focus_waiting_idx
    ON email_thread_focus (link_id)
    WHERE awaiting_reply;
