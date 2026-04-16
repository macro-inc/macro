-- This fixture creates two users. user-1 is the primary test subject.
-- It creates items that are owned by user-1, and items that are owned by user-2
-- but shared with user-1. This allows for thorough testing of the `exclude_owned` flag.

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_2');
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'stripe_1', 1, 'a1111111-1111-1111-1111-111111111111'),
       ('user-2', 'user2@test.com', 'stripe_2', 1, 'a2222222-2222-2222-2222-222222222222');

-- === Items Owned by user-1 (using UUID IDs) ===
INSERT INTO public."Project" ("id", "name", "userId")
VALUES ('a0000000-0000-0000-0000-0000000e0001', 'My Project', 'user-1');
INSERT INTO public."Chat" ("id", "name", "userId")
VALUES ('a0000000-0000-0000-0000-0000000e0002', 'My Chat', 'user-1');
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('a0000000-0000-0000-0000-0000000e0003', 'My Document', 'user-1');

-- === Items Owned by user-2 (and shared with user-1) ===
INSERT INTO public."Project" ("id", "name", "userId")
VALUES ('a0000000-0000-0000-0000-0000000e0004', 'Shared Project', 'user-2');
INSERT INTO public."Chat" ("id", "name", "userId")
VALUES ('a0000000-0000-0000-0000-0000000e0005', 'Shared Chat', 'user-2');
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('a0000000-0000-0000-0000-0000000e0006', 'Shared Document', 'user-2');

-- An item user-1 should NEVER see
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('a0000000-0000-0000-0000-0000000e0007', 'Unrelated Document', 'user-2');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'a0000000-0000-0000-0000-0000000e0003'),
       (2, 'a0000000-0000-0000-0000-0000000e0006'),
       (3, 'a0000000-0000-0000-0000-0000000e0007');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'a0000000-0000-0000-0000-0000000e0003', 'sha-o'),
       (2, 'a0000000-0000-0000-0000-0000000e0006', 'sha-s'),
       (3, 'a0000000-0000-0000-0000-0000000e0007', 'sha-u');

-- === Grant Access via entity_access ===
-- user-1 has access to their own items
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES ('a0000000-0000-0000-0000-0000000e0001'::uuid, 'project', 'user-1', 'user', 'owner'),
       ('a0000000-0000-0000-0000-0000000e0002'::uuid, 'chat', 'user-1', 'user', 'owner'),
       ('a0000000-0000-0000-0000-0000000e0003'::uuid, 'document', 'user-1', 'user', 'owner');

-- user-1 is granted access to user-2's items
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES ('a0000000-0000-0000-0000-0000000e0004'::uuid, 'project', 'user-1', 'user', 'view'),
       ('a0000000-0000-0000-0000-0000000e0005'::uuid, 'chat', 'user-1', 'user', 'view'),
       ('a0000000-0000-0000-0000-0000000e0006'::uuid, 'document', 'user-1', 'user', 'view');

SET session_replication_role = 'origin';
