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

-- Insert macro_user
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@test.com', 'user@test.com', 'stripe_id_1');

-- Insert user
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@test.com', 'user@test.com', 'stripe_id_1', 1, 'a1111111-1111-1111-1111-111111111111')
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
--  ENTITY PROPERTIES FOR DOCUMENTS AND PROJECTS
---------------------------------------------------

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    -- Document in A: Priority = Low, Status = In Progress
    (
        'e1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- id of this thing?
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- doc a id
        'DOCUMENT',                             -- entity_type
        '00000001-0000-0000-0000-000000000003', -- property_def_id Priority
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000001"]}' -- values. id of "Low" in property_options
    ),
    (
        'e2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'DOCUMENT',
        '00000001-0000-0000-0000-000000000002',
        '{"type": "SelectOption",
        "value": ["00000001-0000-0000-0002-000000000004"]}'
    ),

    -- Document in B: Priority = Low, Due Date set
    ('e1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'DOCUMENT', '00000001-0000-0000-0000-000000000003', '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000001"]}'),
    ('e2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'DOCUMENT', '00000001-0000-0000-0000-000000000004', '{"type": "Date", "value": "2025-12-31T23:59:59Z"}'),

    -- Project A: Priority = Medium
    ('e1111111-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'PROJECT', '00000001-0000-0000-0000-000000000003', '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000002"]}')
ON CONFLICT (id) DO NOTHING;

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';
