-- This fixture creates two users. user-1 is the primary test subject.
-- It creates items that are owned by user-1, and items that are owned by user-2
-- but shared with user-1. This allows for thorough testing of the `exclude_owned` flag.

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('user-1', 'user1@test.com', 'stripe_1', 1),
       ('user-2', 'user2@test.com', 'stripe_2', 1);

-- === Items Owned by user-1 ===
INSERT INTO public."Project" ("id", "name", "userId")
VALUES ('project-owned', 'My Project', 'user-1');
INSERT INTO public."Chat" ("id", "name", "userId")
VALUES ('chat-owned', 'My Chat', 'user-1');
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('doc-owned', 'My Document', 'user-1');

-- === Items Owned by user-2 (and shared with user-1) ===
INSERT INTO public."Project" ("id", "name", "userId")
VALUES ('project-shared', 'Shared Project', 'user-2');
INSERT INTO public."Chat" ("id", "name", "userId")
VALUES ('chat-shared', 'Shared Chat', 'user-2');
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('doc-shared', 'Shared Document', 'user-2');

-- An item user-1 should NEVER see
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('doc-unrelated', 'Unrelated Document', 'user-2');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-owned'),
       (2, 'doc-shared'),
       (3, 'doc-unrelated');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'doc-owned', 'sha-o'),
       (2, 'doc-shared', 'sha-s'),
       (3, 'doc-unrelated', 'sha-u');

-- === Grant Access ===
-- user-1 has access to their own items
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-1', 'project-owned', 'project', 'owner'),
       (gen_random_uuid(), 'user-1', 'chat-owned', 'chat', 'owner'),
       (gen_random_uuid(), 'user-1', 'doc-owned', 'document', 'owner');

-- user-1 is granted access to user-2's items
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'user-1', 'project-shared', 'project', 'view'),
       (gen_random_uuid(), 'user-1', 'chat-shared', 'chat', 'view'),
       (gen_random_uuid(), 'user-1', 'doc-shared', 'document', 'view');

SET session_replication_role = 'origin';