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
INSERT INTO public.macro_user (id, username, email, stripe_customer_id)
VALUES ('00000000-0000-0000-0000-000000000001', 'testuser1', 'user@test.com', 'stripe_mu_1')
ON CONFLICT DO NOTHING;
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@test.com', 'user@test.com', 'stripe_id_1', 1, '00000000-0000-0000-0000-000000000001');

---------------------------------
--  PROJECT HIERARCHY SETUP with UUIDs
---------------------------------

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Project A', 'macro|user-1@test.com', NULL, '2023-01-01 10:00:00', '2023-01-01 10:00:00'),
    ('22222222-2222-2222-2222-222222222222', 'Project B', 'macro|user-1@test.com', '11111111-1111-1111-1111-111111111111', '2023-01-01 11:00:00', '2023-01-01 11:00:00'),
    ('33333333-3333-3333-3333-333333333333', 'Project C', 'macro|user-1@test.com', '22222222-2222-2222-2222-222222222222', '2023-01-01 12:00:00', '2023-01-01 12:00:00'),
    ('44444444-4444-4444-4444-444444444444', 'Project D', 'macro|user-1@test.com', NULL, '2023-01-02 10:00:00', '2023-01-02 10:00:00'),
    ('55555555-5555-5555-5555-555555555555', 'Project Isolated', 'macro|user-1@test.com', NULL, '2023-01-03 10:00:00', '2023-01-03 10:00:00');

---------------------------------------------------
--  DOCUMENTS, CHATS, AND THEIR DEPENDENCIES
---------------------------------------------------

-- Document Families
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES
    (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    (2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    (3, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    (4, 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    (5, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
    (6, 'ffffffff-ffff-ffff-ffff-ffffffffffff');

-- Documents with UUID IDs
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt", "updatedAt")
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Document in A', 'macro|user-1@test.com', '11111111-1111-1111-1111-111111111111', 1, 'pdf', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Document in B', 'macro|user-1@test.com', '22222222-2222-2222-2222-222222222222', 2, 'pdf', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Document in C', 'macro|user-1@test.com', '33333333-3333-3333-3333-333333333333', 3, 'md', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Document in D', 'macro|user-1@test.com', '44444444-4444-4444-4444-444444444444', 4, 'pdf', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Standalone Document', 'macro|user-1@test.com', NULL, 5, 'pdf', '2023-01-05 14:00:00', '2023-01-05 14:00:00'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Isolated Document', 'macro|user-1@test.com', '55555555-5555-5555-5555-555555555555', 6, 'pdf', '2023-01-05 15:00:00', '2023-01-05 15:00:00');

-- Document Instances
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES
    (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha_A', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
    (2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha_B', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
    (3, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'sha_C', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
    (4, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'sha_D', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
    (5, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'sha_standalone', '2023-01-05 14:00:00', '2023-01-05 14:00:00'),
    (6, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'sha_isolated', '2023-01-05 15:00:00', '2023-01-05 15:00:00');

-- Chats with UUID IDs
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES
    ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'Chat in A', 'macro|user-1@test.com', '11111111-1111-1111-1111-111111111111', '2023-01-06 10:00:00', '2023-01-06 10:00:00'),
    ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'Chat in B', 'macro|user-1@test.com', '22222222-2222-2222-2222-222222222222', '2023-01-06 11:00:00', '2023-01-06 11:00:00'),
    ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'Chat in C', 'macro|user-1@test.com', '33333333-3333-3333-3333-333333333333', '2023-01-06 12:00:00', '2023-01-06 12:00:00'),
    ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4', 'Standalone Chat', 'macro|user-1@test.com', NULL, '2023-01-06 13:00:00', '2023-01-06 13:00:00'),
    ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'Isolated Chat', 'macro|user-1@test.com', '55555555-5555-5555-5555-555555555555', '2023-01-06 14:00:00', '2023-01-06 14:00:00');

---------------------------------------------------
--  USER ACCESS PERMISSIONS (UserItemAccess)
---------------------------------------------------

INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- User gets 'view' on project-A (gives access to A, B, C and their contents)
(gen_random_uuid(), 'macro|user-1@test.com', '11111111-1111-1111-1111-111111111111', 'project', 'view'),

-- Direct 'edit' on doc-in-B
(gen_random_uuid(), 'macro|user-1@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'edit'),

-- User gets 'owner' on project-D
(gen_random_uuid(), 'macro|user-1@test.com', '44444444-4444-4444-4444-444444444444', 'project', 'owner'),

-- Direct access to standalone items
(gen_random_uuid(), 'macro|user-1@test.com', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'document', 'owner'),
(gen_random_uuid(), 'macro|user-1@test.com', 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4', 'chat', 'owner');

-- User history
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES
    ('macro|user-1@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', '2024-01-01 00:00:00', '2024-01-10 10:00:00'),
    ('macro|user-1@test.com', 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4', 'chat', '2024-01-01 00:00:00', '2024-01-09 10:00:00'),
    ('macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', '2024-01-01 00:00:00', '2024-01-08 10:00:00'),
    ('macro|user-1@test.com', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'chat', '2024-01-01 00:00:00', '2024-01-07 10:00:00');

---------------------------------------------------
--  DOCUMENT SUB TYPES & ASSIGNEES (for importance testing)
---------------------------------------------------

-- Make some documents tasks
INSERT INTO public.document_sub_type ("document_id", "sub_type")
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),  -- doc-in-A is a task
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'task'),  -- doc-in-B is a task
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'task');   -- doc-in-C is a task
-- doc-in-D and standalone doc are NOT tasks

-- Assignee properties for tasks
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    -- doc-in-A: assigned to user-1 (important to user-1)
    (
        'a0000001-0000-0000-0000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'TASK',
        '00000001-0000-0000-0000-000000000001',
        '{"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": "macro|user-1@test.com"}]}'
    ),
    -- doc-in-B: assigned to a different user (NOT important to user-1)
    (
        'a0000001-0000-0000-0000-000000000002',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'TASK',
        '00000001-0000-0000-0000-000000000001',
        '{"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": "macro|other-user@test.com"}]}'
    ),
    -- doc-in-C: assigned to user-1 (important to user-1)
    (
        'a0000001-0000-0000-0000-000000000003',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'TASK',
        '00000001-0000-0000-0000-000000000001',
        '{"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": "macro|user-1@test.com"}]}'
    );

-- Email attachments linked to some documents via document_email
-- doc-in-A and doc-in-B are email attachments; doc-in-C, doc-in-D, standalone, isolated are NOT
INSERT INTO public.email_attachments (id, message_id, filename, mime_type, size_bytes)
VALUES
    ('ea000001-0000-0000-0000-000000000001', 'ea000001-0000-0000-0000-000000000099', 'attachment1.pdf', 'application/pdf', 1024),
    ('ea000001-0000-0000-0000-000000000002', 'ea000001-0000-0000-0000-000000000099', 'attachment2.pdf', 'application/pdf', 2048);

INSERT INTO public.document_email (document_id, email_attachment_id)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ea000001-0000-0000-0000-000000000001'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ea000001-0000-0000-0000-000000000002');

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';
