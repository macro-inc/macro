-- Seed system property definitions for CRM companies.
-- UUIDs mirror system_properties::SystemPropertyKey (Stage 0x10, Owner 0x11,
-- Revenue 0x12) and StageOption (options group 0010).

-- Stage (single-select string)
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
        '00000001-0000-0000-0000-000000000010',
        NULL,
        NULL,
        'Stage',
        'SELECT_STRING',
        false,
        NULL,
        true
    );

-- Owner (single entity reference to a user on the team)
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
        '00000001-0000-0000-0000-000000000011',
        NULL,
        NULL,
        'Owner',
        'ENTITY',
        false,
        'USER',
        true
    );

-- Revenue (number, dollar value)
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
        '00000001-0000-0000-0000-000000000012',
        NULL,
        NULL,
        'Revenue',
        'NUMBER',
        false,
        NULL,
        true
    );

-- Stage options
INSERT INTO property_options (
        id,
        property_definition_id,
        display_order,
        string_value
    )
VALUES (
        '00000001-0000-0000-0010-000000000001',
        '00000001-0000-0000-0000-000000000010',
        0,
        'Lead'
    ),
    (
        '00000001-0000-0000-0010-000000000002',
        '00000001-0000-0000-0000-000000000010',
        1,
        'Qualified'
    ),
    (
        '00000001-0000-0000-0010-000000000003',
        '00000001-0000-0000-0000-000000000010',
        2,
        'Demo'
    ),
    (
        '00000001-0000-0000-0010-000000000004',
        '00000001-0000-0000-0000-000000000010',
        3,
        'Trial'
    ),
    (
        '00000001-0000-0000-0010-000000000005',
        '00000001-0000-0000-0000-000000000010',
        4,
        'Negotiation'
    ),
    (
        '00000001-0000-0000-0010-000000000006',
        '00000001-0000-0000-0000-000000000010',
        5,
        'Customer'
    ),
    (
        '00000001-0000-0000-0010-000000000007',
        '00000001-0000-0000-0000-000000000010',
        6,
        'Churned'
    );
