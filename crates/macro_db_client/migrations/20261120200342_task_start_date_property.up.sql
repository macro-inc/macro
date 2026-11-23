-- Start Date: when work on a task or project begins, the start of the range
-- its Due Date ends. A date like Due Date, and not required, so existing
-- entities have no row for it until someone sets one.
-- The UUID mirrors system_properties::SystemPropertyKey::StartDate (0x15).
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
        '00000001-0000-0000-0000-000000000015',
        NULL,
        NULL,
        'Start Date',
        'DATE',
        false,
        NULL,
        true
    )
ON CONFLICT (id) DO NOTHING;

-- A team or personal property already named Start Date now has a reserved
-- name: check_property_name_not_system would refuse its next update. Its date
-- assignments move to the built-in property, keeping each row's id so the
-- pins that name it still find it. An entity holding two such properties
-- keeps the most recently updated one; the other stays where it is.
-- Database row cells belong to their table's columns and never move.
WITH custom_start_dates AS (
    SELECT id
    FROM property_definitions
    WHERE is_system = FALSE
      AND database_id IS NULL
      AND data_type = 'DATE'
      AND lower(display_name) = 'start date'
),
adopted AS (
    SELECT DISTINCT ON (assignment.entity_id, assignment.entity_type) assignment.id
    FROM entity_properties AS assignment
    WHERE assignment.property_definition_id = ANY(ARRAY(SELECT id FROM custom_start_dates))
      AND assignment.entity_type <> 'DATABASE_ROW'
      AND NOT EXISTS (
          SELECT 1
          FROM entity_properties AS built_in
          WHERE built_in.entity_id = assignment.entity_id
            AND built_in.entity_type = assignment.entity_type
            AND built_in.property_definition_id = '00000001-0000-0000-0000-000000000015'
      )
    ORDER BY assignment.entity_id, assignment.entity_type, assignment.updated_at DESC, assignment.id
)
UPDATE entity_properties
SET property_definition_id = '00000001-0000-0000-0000-000000000015',
    updated_at = NOW()
WHERE id IN (SELECT id FROM adopted);

-- Every such property keeps working under a name of its own, with whatever
-- it still holds: "<name> (custom)", or, where its owner already has that
-- name, one ending in its own id, so none keeps the reserved name.
UPDATE property_definitions AS custom
SET display_name = custom.display_name || ' (custom)',
    updated_at = NOW()
WHERE custom.is_system = FALSE
  AND custom.database_id IS NULL
  AND lower(custom.display_name) = 'start date'
  AND NOT EXISTS (
      SELECT 1
      FROM property_definitions AS taken
      WHERE taken.id <> custom.id
        AND taken.database_id IS NULL
        AND lower(taken.display_name) = lower(custom.display_name || ' (custom)')
        AND (
            (custom.user_id IS NOT NULL AND taken.user_id = custom.user_id)
            OR (custom.team_id IS NOT NULL AND taken.team_id = custom.team_id)
        )
  );

UPDATE property_definitions AS custom
SET display_name = custom.display_name || ' (custom ' || custom.id::text || ')',
    updated_at = NOW()
WHERE custom.is_system = FALSE
  AND custom.database_id IS NULL
  AND lower(custom.display_name) = 'start date';
