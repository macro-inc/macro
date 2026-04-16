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
VALUES ('d0000000-0000-0000-0000-0000000e0001', 'Isolated Top Project', 'user-1', NULL),
       ('d0000000-0000-0000-0000-0000000e0002', 'Isolated Nested Project', 'user-1', 'd0000000-0000-0000-0000-0000000e0001');

-- === Items inside the hierarchy (owned by user-1) ===
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('d0000000-0000-0000-0000-0000000e0003', 'Isolated Chat', 'user-1', 'd0000000-0000-0000-0000-0000000e0001');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('d0000000-0000-0000-0000-0000000e0004', 'Isolated Document', 'user-1', 'd0000000-0000-0000-0000-0000000e0002');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'd0000000-0000-0000-0000-0000000e0004');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'd0000000-0000-0000-0000-0000000e0004', 'sha-iso');

-- === Grant Access to user-2 via entity_access ===
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES
    ('d0000000-0000-0000-0000-0000000e0001'::uuid, 'project', 'user-2', 'user', 'view', NULL),
    ('d0000000-0000-0000-0000-0000000e0002'::uuid, 'project', 'user-2', 'user', 'view', 'd0000000-0000-0000-0000-0000000e0001'),
    ('d0000000-0000-0000-0000-0000000e0003'::uuid, 'chat', 'user-2', 'user', 'comment', NULL),
    ('d0000000-0000-0000-0000-0000000e0004'::uuid, 'document', 'user-2', 'user', 'edit', NULL);

-- === Grant Access to user-1 (for completeness, so user-1 can see their own items) ===
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
    ('d0000000-0000-0000-0000-0000000e0001'::uuid, 'project', 'user-1', 'user', 'owner'),
    ('d0000000-0000-0000-0000-0000000e0002'::uuid, 'project', 'user-1', 'user', 'owner'),
    ('d0000000-0000-0000-0000-0000000e0003'::uuid, 'chat', 'user-1', 'user', 'owner'),
    ('d0000000-0000-0000-0000-0000000e0004'::uuid, 'document', 'user-1', 'user', 'owner');


-- CRITICAL: NO entity_access records are created for user-3.

SET session_replication_role = 'origin';
