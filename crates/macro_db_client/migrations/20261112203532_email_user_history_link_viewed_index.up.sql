-- no-transaction
-- The inbox's viewed sorts read an inbox's opened threads newest view first.
-- The primary key (link_id, thread_id) cannot return that order, so every
-- history row was read and sorted. A per-link equality scan stops at LIMIT on
-- this index. thread_id is left out on purpose: an index holding link_id,
-- thread_id and updated_at looks cheaper to the planner than the primary key
-- for every "when did this inbox open this thread" lookup, and scans the
-- inbox's whole history to answer it.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_user_history_link_viewed
    ON email_user_history (link_id, updated_at DESC);
