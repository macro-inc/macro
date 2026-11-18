-- no-transaction
-- CRM associated-item queries find the database rows whose entity cells
-- reference a company or contact with
-- `values->'value' @> [{"entity_type": ..., "entity_id": ...}]`. Without this
-- index they read every entity cell of every database to find a handful.
-- Only database row cells holding entity references are indexed, so writes to
-- other properties and other cell types never touch it. Must stay a single
-- statement: sqlx sends no-transaction migrations as one batch, and
-- CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS does not repair
-- an INVALID index from an interrupted build; drop it concurrently before
-- retrying. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_ep_database_row_references_gin;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ep_database_row_references_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE entity_type = 'DATABASE_ROW' AND values->>'type' = 'EntityReference';
