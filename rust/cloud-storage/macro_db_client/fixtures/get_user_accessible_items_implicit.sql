-- This fixture tests implicit (hierarchical) permissions.
-- user-2 owns a project structure: Project A contains Project B, Document A, and Chat A.
-- user-1 has access via entity_access to all entities (entity_access has rows for items
-- inside projects via granted_from_project_id).

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
VALUES ('b0000000-0000-0000-0000-0000000e0001', 'Top Level Project', 'user-2', NULL),
       ('b0000000-0000-0000-0000-0000000e0002', 'Nested Project', 'user-2', 'b0000000-0000-0000-0000-0000000e0001');

-- === Items inside Project A (owned by user-2) ===
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('b0000000-0000-0000-0000-0000000e0003', 'Nested Chat', 'user-2', 'b0000000-0000-0000-0000-0000000e0001');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('b0000000-0000-0000-0000-0000000e0004', 'Nested Document', 'user-2', 'b0000000-0000-0000-0000-0000000e0001');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'b0000000-0000-0000-0000-0000000e0004');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'b0000000-0000-0000-0000-0000000e0004', 'sha-A');

-- === Grant Access via entity_access ===
-- entity_access has explicit rows for all entities the user can access (including nested items).
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES
    ('b0000000-0000-0000-0000-0000000e0001'::uuid, 'project', 'user-1', 'user', 'view', NULL),
    ('b0000000-0000-0000-0000-0000000e0002'::uuid, 'project', 'user-1', 'user', 'view', 'b0000000-0000-0000-0000-0000000e0001'),
    ('b0000000-0000-0000-0000-0000000e0003'::uuid, 'chat', 'user-1', 'user', 'view', 'b0000000-0000-0000-0000-0000000e0001'),
    ('b0000000-0000-0000-0000-0000000e0004'::uuid, 'document', 'user-1', 'user', 'view', 'b0000000-0000-0000-0000-0000000e0001');

SET session_replication_role = 'origin';
