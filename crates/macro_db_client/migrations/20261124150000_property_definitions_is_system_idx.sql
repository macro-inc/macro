-- no-transaction
-- The catalog lists (ALL and SYSTEM scopes) select system definitions with
-- `($3 AND is_system) OR team_id = $1 OR user_id = $2`. With no index on the
-- system rows that arm scans every definition, so neither the SYSTEM list nor
-- the BitmapOr over the team and user indexes can avoid a sequential scan.
-- Partial: system definitions are a handful of rows, and only a query whose
-- clause implies is_system can use the index.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_property_definitions_is_system;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_definitions_is_system
    ON property_definitions (id) WHERE is_system;
