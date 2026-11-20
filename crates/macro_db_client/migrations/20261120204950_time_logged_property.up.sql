-- A task's Time logged: whole minutes, the sum of its time_entry rows, written only
-- by the time tracking domain. Not required, and no backfill: a task without a row
-- has logged nothing. The UUID mirrors system_properties::SystemPropertyKey::TimeLogged (0x16).
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
        '00000001-0000-0000-0000-000000000016',
        NULL,
        NULL,
        'Time logged',
        'NUMBER',
        false,
        NULL,
        true
    )
ON CONFLICT (id) DO NOTHING;
