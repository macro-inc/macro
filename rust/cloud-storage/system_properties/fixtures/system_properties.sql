-- Test fixture for system properties

-- Test macro_user (same as properties_db_client fixtures)
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'cus_test1')
ON CONFLICT (id) DO NOTHING;

-- Test user (same as properties_db_client fixtures)
INSERT INTO "User" (id, email, name, "stripeCustomerId", macro_user_id)
VALUES ('user1', 'user1@test.com', 'Test User 1', 'cus_test1', 'a1111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- Custom property definitions
INSERT INTO property_definitions (id, organization_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES 
    ('cccccccc-cccc-cccc-cccc-cccccccccc01', NULL, 'user1', 'Custom Notes', 'STRING', false, 'TASK'),
    ('cccccccc-cccc-cccc-cccc-cccccccccc02', NULL, 'user1', 'Custom Tags', 'SELECT_STRING', true, 'TASK')
ON CONFLICT (id) DO NOTHING;

-- Property options for Custom Tags
INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value)
VALUES 
    ('00000000-0000-0000-0000-000000000101', 'cccccccc-cccc-cccc-cccc-cccccccccc02', 0, NULL, 'urgent'),
    ('00000000-0000-0000-0000-000000000102', 'cccccccc-cccc-cccc-cccc-cccccccccc02', 1, NULL, 'blocked')
ON CONFLICT (id) DO NOTHING;

-- Entity properties
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES 
    -- source-task-with-props
    (
        'f1111111-1111-1111-1111-111111111111',
        'source-task-with-props',
        'TASK',
        '00000001-0000-0000-0000-000000000002', -- Status
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000002"]}' -- In Progress
    ),
    (
        'f2222222-2222-2222-2222-222222222222',
        'source-task-with-props',
        'TASK',
        '00000001-0000-0000-0000-000000000003', -- Priority
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000003"]}' -- High
    ),
    (
        'f5555555-5555-5555-5555-555555555555',
        'source-task-with-props',
        'TASK',
        'cccccccc-cccc-cccc-cccc-cccccccccc01', -- Custom Notes
        '{"type": "String", "value": "This is a custom note"}'
    ),
    (
        'f6666666-6666-6666-6666-666666666666',
        'source-task-with-props',
        'TASK',
        'cccccccc-cccc-cccc-cccc-cccccccccc02', -- Custom Tags
        '{"type": "SelectOption", "value": ["00000000-0000-0000-0000-000000000101"]}' -- urgent
    ),
    -- source-task-overwrite
    (
        'f3333333-3333-3333-3333-333333333333',
        'source-task-overwrite',
        'TASK',
        '00000001-0000-0000-0000-000000000002', -- Status
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000004"]}' -- Completed
    ),
    -- dest-task-existing
    (
        'f4444444-4444-4444-4444-444444444444',
        'dest-task-existing',
        'TASK',
        '00000001-0000-0000-0000-000000000002', -- Status
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000001"]}' -- Not Started
    );
