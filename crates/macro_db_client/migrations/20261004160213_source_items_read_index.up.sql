-- no-transaction
-- Soup reads each of a principal's sources newest first, one kind at a time.
-- Keep a single statement: a SQLx simple-query batch with multiple statements gets an implicit
-- transaction, which CONCURRENTLY forbids.
-- An interrupted build can leave an invalid index; inspect pg_index.indisvalid, drop the invalid
-- index concurrently, then retry this migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_items_read
    ON source_items (source_id, kind, sort_ts DESC, entity_id DESC)
    WHERE sort_ts IS NOT NULL;
