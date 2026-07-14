-- Speed up unified-list property filters.
--
-- The soup AST query filters task properties with predicates on the extracted
-- JSON subfield:
--   values->'value' @> ...  -- entity-reference/assignee contains
--   values->'value' ? ...   -- select-option/status contains
-- The existing idx_entity_properties_values_gin index is on the whole `values`
-- document, so PostgreSQL cannot use it for these `values->'value'` expression
-- predicates. It falls back to scanning rows matched by property_definition_id
-- and applying the JSON predicate as a heap filter.
--
-- These expression indexes let PostgreSQL jump directly to matching property
-- values for the two system properties used by task list filters.
CREATE INDEX IF NOT EXISTS idx_ep_assignee_value_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE property_definition_id = '00000001-0000-0000-0000-000000000001';

-- Default jsonb_ops is intentional: the `?` operator is supported by
-- jsonb_ops, while jsonb_path_ops is optimized for containment (@>) and does
-- not support key/string-existence lookups used by status filters.
CREATE INDEX IF NOT EXISTS idx_ep_status_value_gin
ON entity_properties
USING gin ((values->'value'))
WHERE property_definition_id = '00000001-0000-0000-0000-000000000002';

-- Speed up access checks for users with many channel/team sources.
--
-- The soup query first filters entity_access by source_id and then immediately
-- needs entity_type/entity_id::text to join or semi-join against candidate
-- entities, whose ids are TEXT columns. The existing single-column source_id
-- index can require extra heap reads and a sort/dedup step. This expression
-- btree index matches the hot-path predicate and keeps the fields needed by
-- the access CTE/check together in index order.
CREATE INDEX IF NOT EXISTS idx_entity_access_source_type_entity
ON entity_access (source_id, entity_type, (entity_id::text));
