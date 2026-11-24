-- no-transaction
-- The keyset backfill scans only Depends On assignments, in UUID order.
-- If interrupted, check pg_index and the migration ledger without editing either.
-- If this migration has no successful ledger entry, verify the exact named index
-- definition and drop that owned index CONCURRENTLY before retrying, whether it is
-- invalid or valid (index completion can precede the ledger commit).
CREATE INDEX CONCURRENTLY task_dependency_backfill_source ON entity_properties (id)
WHERE entity_type = 'TASK'
  AND property_definition_id = '00000001-0000-0000-0000-000000000007';
