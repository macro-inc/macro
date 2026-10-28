-- A task's project is its Project system property (single-select entity
-- reference to an initiative) instead of a row in task_initiative.
-- The UUID mirrors system_properties::SystemPropertyKey::Project (0x14).
INSERT INTO property_definitions (
        id,
        team_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000014',
        NULL,
        NULL,
        'Project',
        'ENTITY',
        false,
        'INITIATIVE',
        true
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT
    gen_random_uuid(),
    membership.task_id,
    'TASK'::property_entity_type,
    '00000001-0000-0000-0000-000000000014'::uuid,
    jsonb_build_object(
        'type', 'EntityReference',
        'value', jsonb_build_array(jsonb_build_object(
            'entity_id', membership.initiative_id::text,
            'entity_type', 'INITIATIVE'
        ))
    )
FROM task_initiative AS membership
ON CONFLICT (entity_id, entity_type, property_definition_id) DO UPDATE
SET values = EXCLUDED.values;

-- Project task lists filter tasks by this reference.
CREATE INDEX IF NOT EXISTS idx_ep_project_value_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE property_definition_id = '00000001-0000-0000-0000-000000000014';

-- task_initiative stays until every service reads the Project property:
-- migrations deploy before services, and the previous release still uses it.
-- A later migration drops it.
