-- This fixture tests implicit (hierarchical) permissions.
-- user-2 owns a project structure: Project A contains Project B, Document A, and Chat A.
-- user-1 is ONLY given explicit 'view' access to the top-level Project A.
-- The tests will verify that user-1 correctly gains implicit access to the nested items.

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1', 'user1@test.com', 'stripe_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@test.com', 'stripe_2');
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'stripe_1', 1, 'a1111111-1111-1111-1111-111111111111'), -- The user being tested (gains access)
       ('user-2', 'user2@test.com', 'stripe_2', 1, 'a2222222-2222-2222-2222-222222222222');
-- The owner of the items

-- === Project Hierarchy (owned by user-2) ===
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('project-A', 'Top Level Project', 'user-2', NULL),
       ('project-B', 'Nested Project', 'user-2', 'project-A');

-- === Items inside Project A (owned by user-2) ===
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('chat-A', 'Nested Chat', 'user-2', 'project-A');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('doc-A', 'Nested Document', 'user-2', 'project-A');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-A');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'doc-A', 'sha-A');

-- === Grant Access ===
-- user-1 is ONLY granted access to the top-level project.
-- All other access must be implicitly derived from this single grant.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-1', 'project-A', 'project', 'view');

SET session_replication_role = 'origin';