-- Test organizations and users
-- These reference the Organization and User tables which should exist from macro_db migrations
INSERT INTO "Organization" (id, name)
VALUES (1, 'Test Org 1'),
       (2, 'Test Org 2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "User" (id, email, name, "stripeCustomerId")
VALUES ('user1', 'user1@test.com', 'Test User 1', 'cus_test1'),
       ('user2', 'user2@test.com', 'Test User 2', 'cus_test2'),
       ('user3', 'user3@test.com', 'Test User 3', 'cus_test3')
ON CONFLICT (id) DO NOTHING;

-- Property definitions with various data types
INSERT INTO property_definitions (id, organization_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES 
    -- Organization-owned properties
    ('11111111-1111-1111-1111-111111111111', 1, NULL, 'Priority', 'SELECT_STRING', false, NULL),
    ('22222222-2222-2222-2222-222222222222', 1, NULL, 'Department', 'SELECT_STRING', true, NULL),
    ('33333333-3333-3333-3333-333333333333', 1, NULL, 'Assigned To', 'ENTITY', true, 'USER'),
    ('44444444-4444-4444-4444-444444444444', 1, NULL, 'Score', 'SELECT_NUMBER', false, NULL),
    ('55555555-5555-5555-5555-555555555555', 1, NULL, 'Completed', 'BOOLEAN', false, NULL),
    ('66666666-6666-6666-6666-666666666666', 1, NULL, 'Due Date', 'DATE', false, NULL),
    ('77777777-7777-7777-7777-777777777777', 1, NULL, 'Budget', 'NUMBER', false, NULL),
    ('88888888-8888-8888-8888-888888888888', 1, NULL, 'Description', 'STRING', false, NULL),
    ('99999999-9999-9999-9999-999999999999', 1, NULL, 'Website', 'LINK', false, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, NULL, 'Relevant Documents', 'ENTITY', false, 'DOCUMENT'),
    -- User-owned properties
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'user1', 'Personal Priority', 'SELECT_STRING', false, NULL),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'user1', 'Notes', 'STRING', false, NULL),
    -- Mixed ownership property (org and user)
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 2, 'user2', 'Shared Status', 'SELECT_STRING', false, NULL);

-- Property options for select types
INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value)
VALUES 
    -- Priority options (string)
    ('10111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 0, NULL, 'Low'),
    ('10111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 1, NULL, 'Medium'),
    ('10111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', 2, NULL, 'High'),
    ('10111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111111', 3, NULL, 'Critical'),
    -- Status options (string)
    ('10222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222', 0, NULL, 'Engineering'),
    ('10222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 1, NULL, 'Marketing'),
    ('10222222-2222-2222-2222-222222222223', '22222222-2222-2222-2222-222222222222', 1, NULL, 'Human Resources'),
    -- Score options (number)
    ('10444444-4444-4444-4444-444444444441', '44444444-4444-4444-4444-444444444444', 0, 5.0, NULL),
    ('10444444-4444-4444-4444-444444444442', '44444444-4444-4444-4444-444444444444', 0, 4.0, NULL),
    ('10444444-4444-4444-4444-444444444443', '44444444-4444-4444-4444-444444444444', 2, 3.0, NULL),
    ('10444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 3, 2.0, NULL),
    ('10444444-4444-4444-4444-444444444445', '44444444-4444-4444-4444-444444444444', 4, 1.0, NULL),
    -- Personal Priority options (string)
    ('10bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, NULL, 'Low'),
    ('10bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, NULL, 'High'),
    -- Shared Status options (string)
    ('10dddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 0, NULL, 'Pending'),
    ('20dddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 1, NULL, 'Approved');

-- Entity properties with various values
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES 
    -- Document entities
    ('e0111111-1111-1111-1111-111111111111', 'doc1', 'DOCUMENT', '11111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["10111111-1111-1111-1111-111111111113"]}'),
    ('e0111111-1111-1111-1111-111111111112', 'doc1', 'DOCUMENT', '22222222-2222-2222-2222-222222222222', '{"type": "SelectOption", "value": ["10222222-2222-2222-2222-222222222222"]}'),
    ('e0111111-1111-1111-1111-111111111113', 'doc1', 'DOCUMENT', '33333333-3333-3333-3333-333333333333', '{"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": "user1"}]}'),
    ('e0111111-1111-1111-1111-111111111114', 'doc1', 'DOCUMENT', '55555555-5555-5555-5555-555555555555', '{"type": "Boolean", "value": false}'),
    ('e0111111-1111-1111-1111-111111111115', 'doc1', 'DOCUMENT', '66666666-6666-6666-6666-666666666666', '{"type": "Date", "value": "2025-12-31T23:59:59Z"}'),
    ('e0111111-1111-1111-1111-111111111116', 'doc1', 'DOCUMENT', '88888888-8888-8888-8888-888888888888', '{"type": "String", "value": "Important document for testing"}'),
    -- Document 2
    ('e0222222-2222-2222-2222-222222222221', 'doc2', 'DOCUMENT', '11111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["10111111-1111-1111-1111-111111111111"]}'),
    ('e0222222-2222-2222-2222-222222222222', 'doc2', 'DOCUMENT', '22222222-2222-2222-2222-222222222222', '{"type": "SelectOption", "value": ["10222222-2222-2222-2222-222222222222", "10222222-2222-2222-2222-222222222223"]}'),
    ('e0222222-2222-2222-2222-222222222223', 'doc2', 'DOCUMENT', '33333333-3333-3333-3333-333333333333', '{"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": "user1"}, {"entity_type": "USER", "entity_id": "user2"}]}'),
    ('e0222222-2222-2222-2222-222222222224', 'doc2', 'DOCUMENT', '55555555-5555-5555-5555-555555555555', '{"type": "Boolean", "value": true}'),
    -- Project entities
    ('e0333333-3333-3333-3333-333333333331', 'proj1', 'PROJECT', '11111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["10111111-1111-1111-1111-111111111112"]}'),
    ('e0333333-3333-3333-3333-333333333332', 'proj1', 'PROJECT', '44444444-4444-4444-4444-444444444444', '{"type": "SelectOption", "value": ["10444444-4444-4444-4444-444444444444"]}'),
    ('e0333333-3333-3333-3333-333333333333', 'proj1', 'PROJECT', '77777777-7777-7777-7777-777777777777', '{"type": "Number", "value": 50000.50}'),
    ('e0333333-3333-3333-3333-333333333334', 'proj1', 'PROJECT', '99999999-9999-9999-9999-999999999999', '{"type": "Link", "value": ["https://example.com"]}'),
    ('e0333333-3333-3333-3333-333333333335', 'proj1', 'PROJECT', '33333333-3333-3333-3333-333333333333', '{"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": "user1"}]}'),
    -- Thread entities
    ('e0555555-5555-5555-5555-555555555551', 'thread1', 'THREAD', '11111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["10111111-1111-1111-1111-111111111114"]}'),
    -- Entities with NULL values (property attached but not set)
    ('e0666666-6666-6666-6666-666666666661', 'doc3', 'DOCUMENT', '33333333-3333-3333-3333-333333333333', NULL),
    ('e0666666-6666-6666-6666-666666666662', 'doc3', 'DOCUMENT', '88888888-8888-8888-8888-888888888888', NULL),
    ('e0666666-6666-6666-6666-666666666663', 'doc3', 'DOCUMENT', '55555555-5555-5555-5555-555555555555', NULL);

