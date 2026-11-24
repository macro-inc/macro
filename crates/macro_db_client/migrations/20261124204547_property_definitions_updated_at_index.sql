-- no-transaction
-- The database rows indexer's periodic sweep finds definitions whose options
-- were deleted or merged away since it last looked: the properties service
-- touches `property_definitions.updated_at` then, since the option row is
-- gone. Without this index that read scans every definition each sweep.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_property_definitions_updated_at;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_definitions_updated_at
    ON property_definitions (updated_at);
