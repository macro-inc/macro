-- no-transaction
-- The database rows indexer's periodic sweep finds options relabelled since
-- it last looked (`property_options.updated_at`), so tables using a tag set
-- relabelled outside any database are reindexed. Without this index that
-- read scans every option each sweep.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_property_options_updated_at;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_options_updated_at
    ON property_options (updated_at);
