-- no-transaction
-- The inbox's viewed_at sort orders never-opened threads by id alone, and no
-- index returned one inbox's visible threads in id order, so every inbox
-- thread was read and sorted. A per-link equality scan stops at LIMIT on this
-- index. It also answers "is this opened thread still in the inbox" without
-- reading the thread row.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_inbox_id
    ON email_threads (link_id, id DESC)
    WHERE inbox_visible = TRUE;
