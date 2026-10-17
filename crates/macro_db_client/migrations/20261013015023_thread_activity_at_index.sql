-- no-transaction
-- Channel thread pages read each channel's newest activity_at values and
-- merge them. The tiebreak is root_id::text, matching the existing keyset.
-- INCLUDE (root_id) keeps the page index-only. The predicate must appear in
-- the query for Postgres to use this partial index.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_message_threads_parent_activity
    ON comms_message_threads (
        parent_entity_type,
        parent_entity_id,
        activity_at DESC,
        (root_id::text) DESC
    )
    INCLUDE (root_id)
    WHERE deleted_at IS NULL AND activity_at IS NOT NULL;
