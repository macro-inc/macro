-- no-transaction
-- CRM associated-item queries find every entity whose Companies property
-- references a company with `values->'value' @> [{"entity_id": ...}]`. Like
-- the assignee, status, and project indexes, this partial expression index
-- lets that containment jump to matching rows instead of scanning every
-- Companies row. Must stay a single statement: sqlx sends no-transaction
-- migrations as one batch, and CONCURRENTLY cannot run inside a transaction.
-- IF NOT EXISTS does not repair an INVALID index from an interrupted build;
-- drop it concurrently before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ep_companies_value_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE property_definition_id = '00000001-0000-0000-0000-00000000000c';
