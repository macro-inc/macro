-- no-transaction
-- Sent-view thread index with the id tiebreak, so per-link candidate scans
-- (ORDER BY latest_outbound_message_ts DESC, id DESC LIMIT n) are pure
-- ordered index scans with no sort step. Replaces idx_email_threads_sent_view
-- (link_id, latest_outbound_message_ts DESC), dropped by the next migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_sent_view_link_ts_id
    ON email_threads (link_id, latest_outbound_message_ts DESC, id DESC)
    WHERE (latest_outbound_message_ts IS NOT NULL);
