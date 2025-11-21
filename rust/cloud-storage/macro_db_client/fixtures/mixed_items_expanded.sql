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
--  A -> B -> C
---------------------------------

-- SCENARIO: Top-level project A. User will get 'view' access to this.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'Project A (User has VIEW)', 'macro|user-1@test.com', NULL, '2023-01-01 10:00:00', '2023-01-01 10:00:00');

-- SCENARIO: Nested project B, inside A.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('bbbbbbbb-ffff-ffff-ffff-ffffffffffff', 'Project B (Child of A)', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', '2023-01-01 11:00:00', '2023-01-01 11:00:00');

-- SCENARIO: Deeply nested project C, inside B.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('cccccccc-ffff-ffff-ffff-ffffffffffff', 'Project C (Child of B)', 'macro|user-1@test.com', 'bbbbbbbb-ffff-ffff-ffff-ffffffffffff', '2023-01-01 12:00:00', '2023-01-01 12:00:00');

-- SCENARIO: Another top-level project D. User will get 'owner' access to this project
-- but only 'comment' access to the document inside, to test which permission wins.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('dddddddd-ffff-ffff-ffff-ffffffffffff', 'Project D (User has OWNER)', 'macro|user-1@test.com', NULL, '2023-01-02 10:00:00', '2023-01-02 10:00:00');

-- SCENARIO: An isolated project the user should NOT have access to.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('99999999-ffff-ffff-ffff-ffffffffffff', 'Isolated Project', 'macro|user-1@test.com', NULL, '2023-01-03 10:00:00', '2023-01-03 10:00:00');


---------------------------------------------------
--  DOCUMENTS, CHATS, AND THEIR DEPENDENCIES
---------------------------------------------------

-- Document Families (one for each document)
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
       (3, '11111111-cccc-cccc-cccc-cccccccccccc'),
       (4, '11111111-dddd-dddd-dddd-dddddddddddd'),
       (5, '11111111-0000-0000-0000-000000000000'),
       (6, '11111111-9999-9999-9999-999999999999');

-- Documents
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt",
                               "updatedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Document in A', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 1, 'pdf', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Document in B', 'macro|user-1@test.com', 'bbbbbbbb-ffff-ffff-ffff-ffffffffffff', 2, 'pdf', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
       ('11111111-cccc-cccc-cccc-cccccccccccc', 'Document in C', 'macro|user-1@test.com', 'cccccccc-ffff-ffff-ffff-ffffffffffff', 3, 'pdf', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
       ('11111111-dddd-dddd-dddd-dddddddddddd', 'Document in D', 'macro|user-1@test.com', 'dddddddd-ffff-ffff-ffff-ffffffffffff', 4, 'pdf', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
       ('11111111-0000-0000-0000-000000000000', 'Standalone Document', 'macro|user-1@test.com', NULL, 5, 'pdf', '2023-01-05 14:00:00',
        '2023-01-05 14:00:00'),
       ('11111111-9999-9999-9999-999999999999', 'Isolated Document', 'macro|user-1@test.com', '99999999-ffff-ffff-ffff-ffffffffffff', 6, 'pdf', '2023-01-05 15:00:00',
        '2023-01-05 15:00:00');

-- Document Instances (one for each document)
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha_A', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha_B', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
       (3, '11111111-cccc-cccc-cccc-cccccccccccc', 'sha_C', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
       (4, '11111111-dddd-dddd-dddd-dddddddddddd', 'sha_D', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
       (5, '11111111-0000-0000-0000-000000000000', 'sha_standalone', '2023-01-05 14:00:00', '2023-01-05 14:00:00'),
       (6, '11111111-9999-9999-9999-999999999999', 'sha_isolated', '2023-01-05 15:00:00', '2023-01-05 15:00:00');

-- Chats
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat in A', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', '2023-01-06 10:00:00', '2023-01-06 10:00:00'),
       ('22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Chat in B', 'macro|user-1@test.com', 'bbbbbbbb-ffff-ffff-ffff-ffffffffffff', '2023-01-06 11:00:00', '2023-01-06 11:00:00'),
       ('22222222-cccc-cccc-cccc-cccccccccccc', 'Chat in C', 'macro|user-1@test.com', 'cccccccc-ffff-ffff-ffff-ffffffffffff', '2023-01-06 12:00:00', '2023-01-06 12:00:00'),
       ('22222222-0000-0000-0000-000000000000', 'Standalone Chat', 'macro|user-1@test.com', NULL, '2023-01-06 13:00:00', '2023-01-06 13:00:00'),
       ('22222222-9999-9999-9999-999999999999', 'Isolated Chat', 'macro|user-1@test.com', '99999999-ffff-ffff-ffff-ffffffffffff', '2023-01-06 14:00:00', '2023-01-06 14:00:00');

---------------------------------------------------
--  USER ACCESS PERMISSIONS (UserItemAccess)
---------------------------------------------------

INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- SCENARIO: User gets 'view' on project-A. Access to items in A, B, and C should be inherited from this.
(gen_random_uuid(), 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'project', 'view'),

-- SCENARIO: Direct 'edit' on doc-in-B should override inherited 'view' from project-A.
-- We add a 'view' record too, to ensure DISTINCT ON correctly picks the higher 'edit' level.
(gen_random_uuid(), 'macro|user-1@test.com', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'view'),
(gen_random_uuid(), 'macro|user-1@test.com', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'edit'),

-- SCENARIO: Inherited 'owner' from project-D should override direct 'comment' on doc-in-D.
(gen_random_uuid(), 'macro|user-1@test.com', 'dddddddd-ffff-ffff-ffff-ffffffffffff', 'project', 'owner'),
(gen_random_uuid(), 'macro|user-1@test.com', '11111111-dddd-dddd-dddd-dddddddddddd', 'document', 'comment'),

-- SCENARIO: Direct access to items not in any project.
(gen_random_uuid(), 'macro|user-1@test.com', '11111111-0000-0000-0000-000000000000', 'document', 'owner'),
(gen_random_uuid(), 'macro|user-1@test.com', '22222222-0000-0000-0000-000000000000', 'chat', 'owner');

-- NOTE: There are no access records for project-B, project-C, doc-in-A, chat-in-A, etc.
-- Their visibility depends entirely on the inherited permission from project-A.

-- NOTE: There are no access records for 'project-isolated', 'doc-isolated', or 'chat-isolated'.
-- These items should NOT be returned by the query for 'macro|user-1@test.com'.

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES ('macro|user-1@test.com', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', '2024-01-01 00:00:00', '2024-01-10 10:00:00'), -- Most recent
       ('macro|user-1@test.com', '22222222-0000-0000-0000-000000000000', 'chat', '2024-01-01 00:00:00', '2024-01-09 10:00:00'),
       ('macro|user-1@test.com', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', '2024-01-01 00:00:00', '2024-01-08 10:00:00'),
       ('macro|user-1@test.com', '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', '2024-01-01 00:00:00', '2024-01-07 10:00:00'),
       ('macro|user-1@test.com', '11111111-0000-0000-0000-000000000000', 'document', '2024-01-01 00:00:00', '2024-01-06 14:00:00'),
       ('macro|user-1@test.com', '11111111-dddd-dddd-dddd-dddddddddddd', 'document', '2024-01-01 00:00:00',
        '2023-01-05 13:30:00'),                                                          -- History time is newer than item time
       ('macro|user-1@test.com', '22222222-cccc-cccc-cccc-cccccccccccc', 'chat', '2024-01-01 00:00:00', '2023-01-04 10:00:00');

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';
