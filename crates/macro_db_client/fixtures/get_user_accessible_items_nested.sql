-- This fixture tests a double-nested (deep) hierarchy.
-- user-2 owns a project structure: Project A -> Project B -> Project C.
-- A Document and a Chat are placed in the deepest project, C.
-- user-1 has access via entity_access to all entities.

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
VALUES ('c0000000-0000-0000-0000-0000000e0001', 'Top Level Project', 'user-2', NULL),
       ('c0000000-0000-0000-0000-0000000e0002', 'Mid Level Project', 'user-2', 'c0000000-0000-0000-0000-0000000e0001'),
       ('c0000000-0000-0000-0000-0000000e0003', 'Deeply Nested Project', 'user-2', 'c0000000-0000-0000-0000-0000000e0002');

-- === Items inside the deepest Project C (owned by user-2) ===
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('c0000000-0000-0000-0000-0000000e0004', 'Deep Chat', 'user-2', 'c0000000-0000-0000-0000-0000000e0003');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('c0000000-0000-0000-0000-0000000e0005', 'Deep Document', 'user-2', 'c0000000-0000-0000-0000-0000000e0003');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'c0000000-0000-0000-0000-0000000e0005');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'c0000000-0000-0000-0000-0000000e0005', 'sha-C');

-- === Grant Access via entity_access ===
-- entity_access has rows for each entity the user can access.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES
    ('c0000000-0000-0000-0000-0000000e0001'::uuid, 'project', 'user-1', 'user', 'view', NULL),
    ('c0000000-0000-0000-0000-0000000e0002'::uuid, 'project', 'user-1', 'user', 'view', 'c0000000-0000-0000-0000-0000000e0001'),
    ('c0000000-0000-0000-0000-0000000e0003'::uuid, 'project', 'user-1', 'user', 'view', 'c0000000-0000-0000-0000-0000000e0001'),
    ('c0000000-0000-0000-0000-0000000e0004'::uuid, 'chat', 'user-1', 'user', 'view', 'c0000000-0000-0000-0000-0000000e0001'),
    ('c0000000-0000-0000-0000-0000000e0005'::uuid, 'document', 'user-1', 'user', 'view', 'c0000000-0000-0000-0000-0000000e0001');

SET session_replication_role = 'origin';
