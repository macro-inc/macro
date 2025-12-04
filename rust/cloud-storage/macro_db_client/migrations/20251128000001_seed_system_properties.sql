-- System Properties Migration - Seed Data

-- Assignees (multi-select entity reference to users)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000001',
        NULL,
        NULL,
        'Assignees',
        'ENTITY',
        true,
        'USER',
        true
    );

-- Status (single-select string)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000002',
        NULL,
        NULL,
        'Status',
        'SELECT_STRING',
        false,
        NULL,
        true
    );

-- Priority (single-select string)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000003',
        NULL,
        NULL,
        'Priority',
        'SELECT_STRING',
        false,
        NULL,
        true
    );

-- Due Date (date)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000004',
        NULL,
        NULL,
        'Due Date',
        'DATE',
        false,
        NULL,
        true
    );

-- Parent Task (single entity reference to task)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000005',
        NULL,
        NULL,
        'Parent Task',
        'ENTITY',
        false,
        'TASK',
        true
    );

-- Subtasks (multi-select entity reference to tasks)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000006',
        NULL,
        NULL,
        'Subtasks',
        'ENTITY',
        true,
        'TASK',
        true
    );

-- Depends On (multi-select entity reference to tasks)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000007',
        NULL,
        NULL,
        'Depends On',
        'ENTITY',
        true,
        'TASK',
        true
    );

-- Effort (single-select string)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000008',
        NULL,
        NULL,
        'Effort',
        'SELECT_STRING',
        false,
        NULL,
        true
    );

-- Story Points (single-select number)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-000000000009',
        NULL,
        NULL,
        'Story Points',
        'NUMBER',
        false,
        NULL,
        true
    );

-- Relevant Documents (multi-select entity reference to documents)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-00000000000a',
        NULL,
        NULL,
        'Relevant Documents',
        'ENTITY',
        true,
        'DOCUMENT',
        true
    );

-- Source (single entity reference to any)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-00000000000b',
        NULL,
        NULL,
        'Source',
        'ENTITY',
        false,
        NULL,
        true
    );

-- Companies (multi-select entity reference to companies)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-00000000000c',
        NULL,
        NULL,
        'Companies',
        'ENTITY',
        true,
        'COMPANY',
        true
    );

-- Sender (single entity reference to user)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-00000000000d',
        NULL,
        NULL,
        'Sender',
        'ENTITY',
        false,
        'USER',
        true
    );

-- Recipients (multi-select entity reference to users)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-00000000000e',
        NULL,
        NULL,
        'Recipients',
        'ENTITY',
        true,
        'USER',
        true
    );

-- Subject (string)
INSERT INTO property_definitions (
        id,
        organization_id,
        user_id,
        display_name,
        data_type,
        is_multi_select,
        specific_entity_type,
        is_system
    )
VALUES (
        '00000001-0000-0000-0000-00000000000f',
        NULL,
        NULL,
        'Subject',
        'STRING',
        false,
        NULL,
        true
    );

-- Status options
INSERT INTO property_options (
        id,
        property_definition_id,
        display_order,
        string_value
    )
VALUES (
        '00000001-0000-0000-0002-000000000001',
        '00000001-0000-0000-0000-000000000002',
        0,
        'Not Started'
    ),
    (
        '00000001-0000-0000-0002-000000000002',
        '00000001-0000-0000-0000-000000000002',
        1,
        'In Progress'
    ),
    (
        '00000001-0000-0000-0002-000000000003',
        '00000001-0000-0000-0000-000000000002',
        2,
        'In Review'
    ),
    (
        '00000001-0000-0000-0002-000000000004',
        '00000001-0000-0000-0000-000000000002',
        3,
        'Completed'
    ),
    (
        '00000001-0000-0000-0002-000000000005',
        '00000001-0000-0000-0000-000000000002',
        4,
        'Canceled'
    );

-- Priority options
INSERT INTO property_options (
        id,
        property_definition_id,
        display_order,
        string_value
    )
VALUES (
        '00000001-0000-0000-0003-000000000001',
        '00000001-0000-0000-0000-000000000003',
        0,
        'Low'
    ),
    (
        '00000001-0000-0000-0003-000000000002',
        '00000001-0000-0000-0000-000000000003',
        1,
        'Medium'
    ),
    (
        '00000001-0000-0000-0003-000000000003',
        '00000001-0000-0000-0000-000000000003',
        2,
        'High'
    ),
    (
        '00000001-0000-0000-0003-000000000004',
        '00000001-0000-0000-0000-000000000003',
        3,
        'Critical'
    );

-- Effort options
INSERT INTO property_options (
        id,
        property_definition_id,
        display_order,
        string_value
    )
VALUES (
        '00000001-0000-0000-0008-000000000001',
        '00000001-0000-0000-0000-000000000008',
        0,
        'Small'
    ),
    (
        '00000001-0000-0000-0008-000000000002',
        '00000001-0000-0000-0000-000000000008',
        1,
        'Medium'
    ),
    (
        '00000001-0000-0000-0008-000000000003',
        '00000001-0000-0000-0000-000000000008',
        2,
        'Large'
    );

