-- no-transaction
-- entity_access_source_id_idx is a strict prefix of
-- idx_entity_access_source_type_entity_plain (source_id, entity_type,
-- entity_id); every source_id equality predicate is served by the plain
-- index. Deploy only after confirming the plain index is valid:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
--
-- Single statement on purpose: see the note in
-- 20260715154137_add_entity_access_source_type_entity_plain_index.sql.
DROP INDEX CONCURRENTLY IF EXISTS entity_access_source_id_idx;
