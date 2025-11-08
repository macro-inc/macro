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
VALUES ('project-A', 'Project A (User has VIEW)', 'macro|user-1@test.com', NULL, '2023-01-01 10:00:00', '2023-01-01 10:00:00');

-- SCENARIO: Nested project B, inside A.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('project-B', 'Project B (Child of A)', 'macro|user-1@test.com', 'project-A', '2023-01-01 11:00:00', '2023-01-01 11:00:00');

-- SCENARIO: Deeply nested project C, inside B.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('project-C', 'Project C (Child of B)', 'macro|user-1@test.com', 'project-B', '2023-01-01 12:00:00', '2023-01-01 12:00:00');

-- SCENARIO: Another top-level project D. User will get 'owner' access to this project
-- but only 'comment' access to the document inside, to test which permission wins.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('project-D', 'Project D (User has OWNER)', 'macro|user-1@test.com', NULL, '2023-01-02 10:00:00', '2023-01-02 10:00:00');

-- SCENARIO: An isolated project the user should NOT have access to.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('project-isolated', 'Isolated Project', 'macro|user-1@test.com', NULL, '2023-01-03 10:00:00', '2023-01-03 10:00:00');


---------------------------------------------------
--  DOCUMENTS, CHATS, AND THEIR DEPENDENCIES
---------------------------------------------------

-- Document Families (one for each document)
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-in-A'),
       (2, 'doc-in-B'),
       (3, 'doc-in-C'),
       (4, 'doc-in-D'),
       (5, 'doc-standalone'),
       (6, 'doc-isolated');

-- Documents
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt",
                               "updatedAt")
VALUES ('doc-in-A', 'Document in A', 'macro|user-1@test.com', 'project-A', 1, 'pdf', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       ('doc-in-B', 'Document in B', 'macro|user-1@test.com', 'project-B', 2, 'pdf', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
       ('doc-in-C', 'Document in C', 'macro|user-1@test.com', 'project-C', 3, 'pdf', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
       ('doc-in-D', 'Document in D', 'macro|user-1@test.com', 'project-D', 4, 'pdf', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
       ('doc-standalone', 'Standalone Document', 'macro|user-1@test.com', NULL, 5, 'pdf', '2023-01-05 14:00:00',
        '2023-01-05 14:00:00'),
       ('doc-isolated', 'Isolated Document', 'macro|user-1@test.com', 'project-isolated', 6, 'pdf', '2023-01-05 15:00:00',
        '2023-01-05 15:00:00');

-- Document Instances (one for each document)
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, 'doc-in-A', 'sha_A', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       (2, 'doc-in-B', 'sha_B', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
       (3, 'doc-in-C', 'sha_C', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
       (4, 'doc-in-D', 'sha_D', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
       (5, 'doc-standalone', 'sha_standalone', '2023-01-05 14:00:00', '2023-01-05 14:00:00'),
       (6, 'doc-isolated', 'sha_isolated', '2023-01-05 15:00:00', '2023-01-05 15:00:00');

-- Chats
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('chat-in-A', 'Chat in A', 'macro|user-1@test.com', 'project-A', '2023-01-06 10:00:00', '2023-01-06 10:00:00'),
       ('chat-in-B', 'Chat in B', 'macro|user-1@test.com', 'project-B', '2023-01-06 11:00:00', '2023-01-06 11:00:00'),
       ('chat-in-C', 'Chat in C', 'macro|user-1@test.com', 'project-C', '2023-01-06 12:00:00', '2023-01-06 12:00:00'),
       ('chat-standalone', 'Standalone Chat', 'macro|user-1@test.com', NULL, '2023-01-06 13:00:00', '2023-01-06 13:00:00'),
       ('chat-isolated', 'Isolated Chat', 'macro|user-1@test.com', 'project-isolated', '2023-01-06 14:00:00', '2023-01-06 14:00:00');

---------------------------------------------------
--  USER ACCESS PERMISSIONS (UserItemAccess)
---------------------------------------------------

INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- SCENARIO: User gets 'view' on project-A. Access to items in A, B, and C should be inherited from this.
(gen_random_uuid(), 'macro|user-1@test.com', 'project-A', 'project', 'view'),

-- SCENARIO: Direct 'edit' on doc-in-B should override inherited 'view' from project-A.
-- We add a 'view' record too, to ensure DISTINCT ON correctly picks the higher 'edit' level.
(gen_random_uuid(), 'macro|user-1@test.com', 'doc-in-B', 'document', 'view'),
(gen_random_uuid(), 'macro|user-1@test.com', 'doc-in-B', 'document', 'edit'),

-- SCENARIO: Inherited 'owner' from project-D should override direct 'comment' on doc-in-D.
(gen_random_uuid(), 'macro|user-1@test.com', 'project-D', 'project', 'owner'),
(gen_random_uuid(), 'macro|user-1@test.com', 'doc-in-D', 'document', 'comment'),

-- SCENARIO: Direct access to items not in any project.
(gen_random_uuid(), 'macro|user-1@test.com', 'doc-standalone', 'document', 'owner'),
(gen_random_uuid(), 'macro|user-1@test.com', 'chat-standalone', 'chat', 'owner');

-- NOTE: There are no access records for project-B, project-C, doc-in-A, chat-in-A, etc.
-- Their visibility depends entirely on the inherited permission from project-A.

-- NOTE: There are no access records for 'project-isolated', 'doc-isolated', or 'chat-isolated'.
-- These items should NOT be returned by the query for 'macro|user-1@test.com'.

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES ('macro|user-1@test.com', 'doc-in-B', 'document', '2024-01-01 00:00:00', '2024-01-10 10:00:00'), -- Most recent
       ('macro|user-1@test.com', 'chat-standalone', 'chat', '2024-01-01 00:00:00', '2024-01-09 10:00:00'),
       ('macro|user-1@test.com', 'doc-in-A', 'document', '2024-01-01 00:00:00', '2024-01-08 10:00:00'),
       ('macro|user-1@test.com', 'chat-in-A', 'chat', '2024-01-01 00:00:00', '2024-01-07 10:00:00'),
       ('macro|user-1@test.com', 'doc-standalone', 'document', '2024-01-01 00:00:00', '2024-01-06 14:00:00'),
       ('macro|user-1@test.com', 'doc-in-D', 'document', '2024-01-01 00:00:00',
        '2023-01-05 13:30:00'),                                                          -- History time is newer than item time
       ('macro|user-1@test.com', 'chat-in-C', 'chat', '2024-01-01 00:00:00', '2023-01-04 10:00:00');

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';
