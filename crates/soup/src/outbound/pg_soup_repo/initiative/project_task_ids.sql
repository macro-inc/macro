-- The Project property id is a literal so a generic plan proves the partial
-- predicate of idx_ep_project_value_gin. A Project value holds exactly one
-- reference, as entity access requires.
SELECT ep.entity_id AS "id!"
FROM entity_properties ep
JOIN "Document" task ON task.id = ep.entity_id AND task."deletedAt" IS NULL
WHERE ep.property_definition_id = '00000001-0000-0000-0000-000000000014'
  AND ep.entity_type = 'TASK'
  AND ep.values -> 'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1::text, 'entity_type', 'INITIATIVE'))
  AND CASE WHEN jsonb_typeof(ep.values -> 'value') = 'array'
           THEN jsonb_array_length(ep.values -> 'value') END = 1
ORDER BY ep.entity_id
