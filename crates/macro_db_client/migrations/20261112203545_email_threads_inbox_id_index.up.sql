-- no-transaction
-- The inbox's viewed_at sort orders never-opened threads by id alone, and no
-- index returned one inbox's visible threads in id order, so every inbox
-- thread was read and sorted. A per-link equality scan stops at LIMIT on this
-- index. It also answers "is this opened thread still in the inbox" without
-- reading the thread row.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY idx_email_threads_inbox_id
    ON email_threads (link_id, id DESC)
    WHERE inbox_visible = TRUE;
