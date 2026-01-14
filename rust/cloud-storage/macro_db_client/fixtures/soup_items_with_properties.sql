-- This fixture builds on mixed_items_expanded to add system properties to documents and projects
-- Disable foreign key constraints temporarily for easier setup
SET session_replication_role = 'replica';

---------------------------------
--  BASE SETUP: USER & ORG
---------------------------------

-- Create Organization (needed for User foreign key)
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT')
ON CONFLICT DO NOTHING;

-- Insert user
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('macro|user-1@test.com', 'user@test.com', 'stripe_id_1', 1)
ON CONFLICT DO NOTHING;

---------------------------------
--  PROJECT HIERARCHY SETUP
---------------------------------

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'Project A (User has VIEW)', 'macro|user-1@test.com', NULL, '2023-01-01 10:00:00', '2023-01-01 10:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('bbbbbbbb-ffff-ffff-ffff-ffffffffffff', 'Project B (Child of A)', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', '2023-01-01 11:00:00', '2023-01-01 11:00:00');

---------------------------------------------------
--  DOCUMENTS AND THEIR DEPENDENCIES
---------------------------------------------------

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt", "updatedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Document in A', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 1, 'pdf', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Document in B', 'macro|user-1@test.com', 'bbbbbbbb-ffff-ffff-ffff-ffffffffffff', 2, 'pdf', '2023-01-05 11:00:00', '2023-01-05 11:00:00');

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha_A', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha_B', '2023-01-05 11:00:00', '2023-01-05 11:00:00');

---------------------------------------------------
--  USER ACCESS PERMISSIONS (UserItemAccess)
---------------------------------------------------

INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
(gen_random_uuid(), 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'project', 'view'),
(gen_random_uuid(), 'macro|user-1@test.com', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'edit');

---------------------------------------------------
--  SYSTEM PROPERTY DEFINITIONS
--  These use the fixed system property UUIDs from SystemPropertyKey
---------------------------------------------------

INSERT INTO property_definitions (id, organization_id, user_id, display_name, data_type, is_multi_select, specific_entity_type, is_system)
VALUES
    -- System properties (using SystemPropertyKey UUIDs)
    ('00000001-0000-0000-0000-000000000001', NULL, NULL, 'Assignees', 'ENTITY', true, 'USER', true),
    ('00000001-0000-0000-0000-000000000002', NULL, NULL, 'Status', 'SELECT_STRING', false, NULL, true),
    ('00000001-0000-0000-0000-000000000003', NULL, NULL, 'Priority', 'SELECT_STRING', false, NULL, true),
    ('00000001-0000-0000-0000-000000000004', NULL, NULL, 'Due Date', 'DATE', false, NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Priority options
INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value)
VALUES
    ('a0000001-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000003', 0, NULL, 'Low'),
    ('a0000001-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000003', 1, NULL, 'Medium'),
    ('a0000001-0000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000003', 2, NULL, 'High')
ON CONFLICT (id) DO NOTHING;

-- Status options
INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value)
VALUES
    ('b0000001-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000002', 0, NULL, 'Not Started'),
    ('b0000001-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000002', 1, NULL, 'In Progress'),
    ('b0000001-0000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000002', 2, NULL, 'Completed')
ON CONFLICT (id) DO NOTHING;

---------------------------------------------------
--  ENTITY PROPERTIES FOR DOCUMENTS AND PROJECTS
---------------------------------------------------

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    -- Document in A: Priority = High, Status = In Progress
    ('e1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DOCUMENT', '00000001-0000-0000-0000-000000000003', '{"type": "SelectOption", "value": ["a0000001-0000-0000-0000-000000000003"]}'),
    ('e2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DOCUMENT', '00000001-0000-0000-0000-000000000002', '{"type": "SelectOption", "value": ["b0000001-0000-0000-0000-000000000002"]}'),

    -- Document in B: Priority = Low, Due Date set
    ('e1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'DOCUMENT', '00000001-0000-0000-0000-000000000003', '{"type": "SelectOption", "value": ["a0000001-0000-0000-0000-000000000001"]}'),
    ('e2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'DOCUMENT', '00000001-0000-0000-0000-000000000004', '{"type": "Date", "value": "2025-12-31T23:59:59Z"}'),

    -- Project A: Priority = Medium
    ('e1111111-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'PROJECT', '00000001-0000-0000-0000-000000000003', '{"type": "SelectOption", "value": ["a0000001-0000-0000-0000-000000000002"]}')
ON CONFLICT (id) DO NOTHING;

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';
