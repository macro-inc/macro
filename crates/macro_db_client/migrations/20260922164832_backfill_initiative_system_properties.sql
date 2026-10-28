-- Reuse the task definitions and null defaults for existing initiatives.
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT gen_random_uuid(), initiative.id::text, 'INITIATIVE'::property_entity_type, definition.id, 'null'::jsonb
FROM initiative
CROSS JOIN property_definitions AS definition
WHERE definition.id IN (
    '00000001-0000-0000-0000-000000000001'::uuid, -- Assignees
    '00000001-0000-0000-0000-000000000002'::uuid, -- Status
    '00000001-0000-0000-0000-000000000003'::uuid, -- Priority
    '00000001-0000-0000-0000-000000000004'::uuid  -- Due Date
)
ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;
