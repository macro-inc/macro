-- Contacts (multi-select entity reference to CRM contacts). Pairs with the
-- existing Companies property (0x0c) to associate any entity with CRM records.
-- The UUID mirrors system_properties::SystemPropertyKey::Contacts (0x13).
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
        '00000001-0000-0000-0000-000000000013',
        NULL,
        NULL,
        'Contacts',
        'ENTITY',
        true,
        'CONTACT',
        true
    )
ON CONFLICT (id) DO NOTHING;
