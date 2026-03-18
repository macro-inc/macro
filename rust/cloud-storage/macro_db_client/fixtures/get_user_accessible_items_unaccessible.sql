-- This fixture tests permission isolation.
-- user-1 owns a nested project structure with a document and chat.
-- user-1 shares the top-level project with user-2, AND also explicitly shares a nested doc/chat.
-- user-3 has absolutely no access to any of these items.
-- The tests will verify that queries for user-3 correctly return zero items.

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@test.com', 'user3@test.com', 'stripe_3');
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'stripe_1', 1, 'a1111111-1111-1111-1111-111111111111'), -- The owner
       ('user-2', 'user2@test.com', 'stripe_2', 1, 'a2222222-2222-2222-2222-222222222222'), -- The user with shared access
       ('user-3', 'user3@test.com', 'stripe_3', 1, 'a3333333-3333-3333-3333-333333333333');
-- The isolated user (test subject)

-- === Project Hierarchy (owned by user-1) ===
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('project-A-iso', 'Isolated Top Project', 'user-1', NULL),
       ('project-B-iso', 'Isolated Nested Project', 'user-1', 'project-A-iso');

-- === Items inside the hierarchy (owned by user-1) ===
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('chat-A-iso', 'Isolated Chat', 'user-1', 'project-A-iso');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('doc-B-iso', 'Isolated Document', 'user-1', 'project-B-iso');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-B-iso');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'doc-B-iso', 'sha-iso');

-- === Grant Access to user-2 ===
-- user-1 shares the top-level project with user-2 (implicit access)
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-2', 'project-A-iso', 'project', 'view');

-- user-1 ALSO explicitly shares the nested items with user-2
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-2', 'chat-A-iso', 'chat', 'comment'),
       (gen_random_uuid(), 'user-2', 'doc-B-iso', 'document', 'edit');


-- === Grant Access to user-1 (for completeness, so user-1 can see their own items) ===
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-1', 'project-A-iso', 'project', 'owner'),
       (gen_random_uuid(), 'user-1', 'project-B-iso', 'project', 'owner'),
       (gen_random_uuid(), 'user-1', 'chat-A-iso', 'chat', 'owner'),
       (gen_random_uuid(), 'user-1', 'doc-B-iso', 'document', 'owner');


-- CRITICAL: NO UserItemAccess records are created for user-3.

SET session_replication_role = 'origin';