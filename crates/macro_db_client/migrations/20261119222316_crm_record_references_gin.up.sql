-- no-transaction
-- A CRM record lists the tasks whose own custom entity-reference properties
-- name it, found with
-- `values->'value' @> [{"entity_type": ..., "entity_id": ...}]`. No other
-- index reaches those values, so without this one the lookup reads every
-- value of every custom entity property. Only values that reference a company
-- or a contact are indexed, and the Companies and Contacts properties and
-- database row cells, which have their own indexes, are left out: the index
-- holds the custom-property references to CRM records and nothing else, and a
-- write of any other value adds no entry to it. A query uses it only by
-- repeating this predicate (`property_edges` in crates/soup). Must stay a
-- single statement: sqlx sends no-transaction migrations as one batch, and
-- CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS does not repair
-- an INVALID index from an interrupted build; drop it concurrently before
-- retrying. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ep_crm_record_references_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE entity_type <> 'DATABASE_ROW'
  AND property_definition_id <> '00000001-0000-0000-0000-00000000000c'
  AND property_definition_id <> '00000001-0000-0000-0000-000000000013'
  AND (values->'value' @> '[{"entity_type": "COMPANY"}]'
       OR values->'value' @> '[{"entity_type": "CONTACT"}]');
