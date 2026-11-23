-- no-transaction
-- The inbox's viewed sorts read an inbox's opened threads newest view first.
-- The primary key (link_id, thread_id) cannot return that order, so every
-- history row was read and sorted. A per-link equality scan stops at LIMIT on
-- this index. thread_id is left out on purpose: an index holding link_id,
-- thread_id and updated_at looks cheaper to the planner than the primary key
-- for every "when did this inbox open this thread" lookup, and scans the
-- inbox's whole history to answer it.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY idx_email_user_history_link_viewed
    ON email_user_history (link_id, updated_at DESC);
