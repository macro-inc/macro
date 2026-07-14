-- no-transaction
-- Superseded by idx_email_threads_sent_view_link_ts_id (adds the id tiebreak).
DROP INDEX CONCURRENTLY IF EXISTS idx_email_threads_sent_view;
