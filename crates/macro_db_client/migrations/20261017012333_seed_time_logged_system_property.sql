-- Time Logged system property for task time tracking.
-- The UUID mirrors system_properties::SystemPropertyKey::TimeLogged (0x15).
-- Stores duration in minutes as a NUMBER type.
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
        'Time Logged',
        'NUMBER',
        false,
        NULL,
        true
    )
ON CONFLICT (id) DO NOTHING;
