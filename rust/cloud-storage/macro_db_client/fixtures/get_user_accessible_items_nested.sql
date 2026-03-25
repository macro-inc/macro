-- This fixture tests a double-nested (deep) hierarchy.
-- user-2 owns a project structure: Project A -> Project B -> Project C.
-- A Document and a Chat are placed in the deepest project, C.
-- user-1 is ONLY given explicit 'view' access to the top-level Project A.
-- Tests must verify that user-1 can see all projects and the content in Project C.

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_2');
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'stripe_1', 1, 'a1111111-1111-1111-1111-111111111111'), -- The user being tested (gains access)
       ('user-2', 'user2@test.com', 'stripe_2', 1, 'a2222222-2222-2222-2222-222222222222');
-- The owner of the items

-- === Project Hierarchy (A -> B -> C, owned by user-2) ===
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('project-A', 'Top Level Project', 'user-2', NULL),
       ('project-B', 'Mid Level Project', 'user-2', 'project-A'),
       ('project-C', 'Deeply Nested Project', 'user-2', 'project-B');

-- === Items inside the deepest Project C (owned by user-2) ===
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('chat-C', 'Deep Chat', 'user-2', 'project-C');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('doc-C', 'Deep Document', 'user-2', 'project-C');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-C');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'doc-C', 'sha-C');

-- === Grant Access ===
-- user-1 is ONLY granted access to the top-level project A.
-- All other access must be implicitly derived from this single grant.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-1', 'project-A', 'project', 'view');

SET session_replication_role = 'origin';