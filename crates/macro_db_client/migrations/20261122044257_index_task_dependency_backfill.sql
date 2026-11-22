-- no-transaction
-- The keyset backfill scans only Depends On assignments, in UUID order.
CREATE INDEX CONCURRENTLY task_dependency_backfill_source ON entity_properties (id)
WHERE entity_type = 'TASK'
  AND property_definition_id = '00000001-0000-0000-0000-000000000007';
