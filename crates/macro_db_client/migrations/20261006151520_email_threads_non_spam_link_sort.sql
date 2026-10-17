-- no-transaction
-- All-mail, drafts, starred, important, other, and user-label thread pages
-- sort by COALESCE(latest_non_spam_message_ts, updated_at) DESC, id DESC.
-- The older idx_email_threads_non_spam_ts_id orders the raw timestamp and
-- skips rows where it is null, so it cannot serve that expression. A
-- per-link equality scan (link_id = $link) stops at LIMIT on this index.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_email_threads_non_spam_link_ts_id;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_non_spam_link_ts_id
    ON email_threads (link_id, (COALESCE(latest_non_spam_message_ts, updated_at)) DESC, id DESC);
