-- Fixture to test the "no frecency" unexpanded queries
-- Creates items where some have frecency_aggregates records and some don't
-- Uses EXPLICIT UserItemAccess grants (not project-based inheritance)

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id_1', '1');

-- Create documents (2 with frecency, 2 without)
-- Documents WITH frecency (should be filtered out)
INSERT INTO public."Document" ("id", "name", "owner", "createdAt", "updatedAt")
VALUES ('44444444-ffff-ffff-ffff-ffffffffffff', 'Doc With Frecency 1', 'macro|user@user.com', '2024-01-10 10:00:00', '2024-02-15 10:00:00'),
       ('55555555-ffff-ffff-ffff-ffffffffffff', 'Doc With Frecency 2', 'macro|user@user.com', '2024-01-11 10:00:00', '2024-02-14 10:00:00');

-- Documents WITHOUT frecency (should be returned)
INSERT INTO public."Document" ("id", "name", "owner", "createdAt", "updatedAt")
VALUES ('44444444-4444-4444-4444-444444444444', 'Doc No Frecency 1', 'macro|user@user.com', '2024-01-12 10:00:00', '2024-02-13 10:00:00'),
       ('55555555-5555-5555-5555-555555555555', 'Doc No Frecency 2', 'macro|user@user.com', '2024-01-13 10:00:00', '2024-02-12 10:00:00');

-- Create chats (1 with frecency, 2 without)
-- Chat WITH frecency (should be filtered out)
INSERT INTO public."Chat" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('66666666-ffff-ffff-ffff-ffffffffffff', 'Chat With Frecency 1', 'macro|user@user.com', '2024-01-14 10:00:00', '2024-02-11 10:00:00');

-- Chats WITHOUT frecency (should be returned)
INSERT INTO public."Chat" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('66666666-6666-6666-6666-666666666666', 'Chat No Frecency 1', 'macro|user@user.com', '2024-01-15 10:00:00', '2024-02-10 10:00:00'),
       ('77777777-7777-7777-7777-777777777777', 'Chat No Frecency 2', 'macro|user@user.com', '2024-01-16 10:00:00', '2024-02-09 10:00:00');

-- Create projects (1 with frecency, 1 without)
-- Project WITH frecency (should be filtered out)
INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('88888888-ffff-ffff-ffff-ffffffffffff', 'Project With Frecency', 'macro|user@user.com', '2024-01-17 10:00:00', '2024-02-08 10:00:00');

-- Project WITHOUT frecency (should be returned)
INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('88888888-8888-8888-8888-888888888888', 'Project No Frecency', 'macro|user@user.com', '2024-01-18 10:00:00', '2024-02-07 10:00:00');

-- Explicit UserItemAccess grants for all items (unexpanded requires this)
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user@user.com', '44444444-ffff-ffff-ffff-ffffffffffff', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '55555555-ffff-ffff-ffff-ffffffffffff', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '44444444-4444-4444-4444-444444444444', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '55555555-5555-5555-5555-555555555555', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '66666666-ffff-ffff-ffff-ffffffffffff', 'chat', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '66666666-6666-6666-6666-666666666666', 'chat', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '77777777-7777-7777-7777-777777777777', 'chat', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '88888888-ffff-ffff-ffff-ffffffffffff', 'project', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', '88888888-8888-8888-8888-888888888888', 'project', 'owner');

-- Dependencies for documents
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '44444444-ffff-ffff-ffff-ffffffffffff'),
       (2, '55555555-ffff-ffff-ffff-ffffffffffff'),
       (3, '44444444-4444-4444-4444-444444444444'),
       (4, '55555555-5555-5555-5555-555555555555');

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, '44444444-ffff-ffff-ffff-ffffffffffff', 'sha-1'),
       (2, '55555555-ffff-ffff-ffff-ffffffffffff', 'sha-2'),
       (3, '44444444-4444-4444-4444-444444444444', 'sha-3'),
       (4, '55555555-5555-5555-5555-555555555555', 'sha-4');

-- User History entries for ordering tests
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user@user.com', '44444444-4444-4444-4444-444444444444', 'document', '2024-03-17 10:00:00'),
       ('macro|user@user.com', '55555555-5555-5555-5555-555555555555', 'document', '2024-03-16 10:00:00'),
       ('macro|user@user.com', '66666666-6666-6666-6666-666666666666', 'chat', '2024-03-15 10:00:00'),
       ('macro|user@user.com', '77777777-7777-7777-7777-777777777777', 'chat', '2024-03-14 10:00:00'),
       ('macro|user@user.com', '88888888-8888-8888-8888-888888888888', 'project', '2024-03-13 10:00:00'),
       ('macro|user@user.com', '44444444-ffff-ffff-ffff-ffffffffffff', 'document', '2024-03-12 10:00:00'),
       ('macro|user@user.com', '66666666-ffff-ffff-ffff-ffffffffffff', 'chat', '2024-03-11 10:00:00');

-- Insert frecency_aggregates for items WITH frecency
INSERT INTO public."frecency_aggregates" ("user_id", "entity_id", "entity_type", "frecency_score", "event_count", "first_event", "recent_events")
VALUES ('macro|user@user.com', '44444444-ffff-ffff-ffff-ffffffffffff', 'document', 100.0, 10, '2024-01-10 10:00:00', '[]'::jsonb),
       ('macro|user@user.com', '55555555-ffff-ffff-ffff-ffffffffffff', 'document', 90.0, 8, '2024-01-11 10:00:00', '[]'::jsonb),
       ('macro|user@user.com', '66666666-ffff-ffff-ffff-ffffffffffff', 'chat', 80.0, 6, '2024-01-14 10:00:00', '[]'::jsonb),
       ('macro|user@user.com', '88888888-ffff-ffff-ffff-ffffffffffff', 'project', 70.0, 5, '2024-01-17 10:00:00', '[]'::jsonb);

SET session_replication_role = 'origin';
