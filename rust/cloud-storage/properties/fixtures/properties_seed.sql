-- Entity with status attached but not completed (in progress)
INSERT INTO entity_properties (
        id,
        entity_id,
        entity_type,
        property_definition_id,
        values,
        created_at,
        updated_at
    )
VALUES (
        '00000001-0000-0000-0000-000000000301',
        'entity-status-incomplete',
        'DOCUMENT',
        '00000001-0000-0000-0000-000000000002',
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000002"]}'::jsonb,
        -- In Progress
        NOW(),
        NOW()
    );
-- Entity with status already completed
INSERT INTO entity_properties (
        id,
        entity_id,
        entity_type,
        property_definition_id,
        values,
        created_at,
        updated_at
    )
VALUES (
        '00000001-0000-0000-0000-000000000302',
        'entity-status-complete',
        'DOCUMENT',
        '00000001-0000-0000-0000-000000000002',
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000004"]}'::jsonb,
        -- Completed
        NOW(),
        NOW()
    );