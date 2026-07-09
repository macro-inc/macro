-- no-transaction
-- Matches the Important-tab candidate scan (inbox view sort field + id
-- tiebreak) so per-link ordered scans stop at the LIMIT. Noise rides the
-- existing idx_email_threads_inbox_view_not_null and skips signal rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_signal_view
    ON email_threads (link_id, latest_inbound_message_ts DESC, id DESC)
    WHERE inbox_visible AND is_signal AND latest_inbound_message_ts IS NOT NULL;
