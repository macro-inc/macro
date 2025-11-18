-- Fixture to test the "no frecency" queries
-- Creates items where some have frecency_aggregates records and some don't
-- The queries should ONLY return items WITHOUT frecency records

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('macro|user-1@test.com', 'user-1@test.com', 'stripe_id_1', '1');

-- Project Hierarchy
INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Project A', 'macro|user-1@test.com', '2024-01-01 09:00:00', '2024-01-01 09:00:00');

-- Give user access to the project
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'owner');

-- Create documents (3 with frecency, 2 without)
-- Documents WITH frecency (should be filtered out)
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "createdAt", "updatedAt")
VALUES ('11111111-1111-1111-1111-111111111111', 'Doc With Frecency 1', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-10 10:00:00', '2024-02-15 10:00:00'),
       ('22222222-2222-2222-2222-222222222222', 'Doc With Frecency 2', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-11 10:00:00', '2024-02-14 10:00:00'),
       ('33333333-3333-3333-3333-333333333333', 'Doc With Frecency 3', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-12 10:00:00', '2024-02-13 10:00:00');

-- Documents WITHOUT frecency (should be returned)
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "createdAt", "updatedAt")
VALUES ('44444444-4444-4444-4444-444444444444', 'Doc No Frecency 1', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-13 10:00:00', '2024-02-12 10:00:00'),
       ('55555555-5555-5555-5555-555555555555', 'Doc No Frecency 2', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-14 10:00:00', '2024-02-11 10:00:00');

-- Create chats (2 with frecency, 2 without)
-- Chats WITH frecency (should be filtered out)
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('66666666-6666-6666-6666-666666666666', 'Chat With Frecency 1', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-15 10:00:00', '2024-02-10 10:00:00'),
       ('77777777-7777-7777-7777-777777777777', 'Chat With Frecency 2', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-16 10:00:00', '2024-02-09 10:00:00');

-- Chats WITHOUT frecency (should be returned)
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('88888888-8888-8888-8888-888888888888', 'Chat No Frecency 1', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-17 10:00:00', '2024-02-08 10:00:00'),
       ('99999999-9999-9999-9999-999999999999', 'Chat No Frecency 2', 'macro|user-1@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-18 10:00:00', '2024-02-07 10:00:00');

-- Dependencies for documents
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-1111-1111-1111-111111111111'),
       (2, '22222222-2222-2222-2222-222222222222'),
       (3, '33333333-3333-3333-3333-333333333333'),
       (4, '44444444-4444-4444-4444-444444444444'),
       (5, '55555555-5555-5555-5555-555555555555');

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, '11111111-1111-1111-1111-111111111111', 'sha-1'),
       (2, '22222222-2222-2222-2222-222222222222', 'sha-2'),
       (3, '33333333-3333-3333-3333-333333333333', 'sha-3'),
       (4, '44444444-4444-4444-4444-444444444444', 'sha-4'),
       (5, '55555555-5555-5555-5555-555555555555', 'sha-5');

-- User History entries for ordering tests
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user-1@test.com', '44444444-4444-4444-4444-444444444444', 'document', '2024-03-15 10:00:00'),
       ('macro|user-1@test.com', '55555555-5555-5555-5555-555555555555', 'document', '2024-03-14 10:00:00'),
       ('macro|user-1@test.com', '88888888-8888-8888-8888-888888888888', 'chat', '2024-03-13 10:00:00'),
       ('macro|user-1@test.com', '99999999-9999-9999-9999-999999999999', 'chat', '2024-03-12 10:00:00'),
       ('macro|user-1@test.com', '11111111-1111-1111-1111-111111111111', 'document', '2024-03-11 10:00:00'),
       ('macro|user-1@test.com', '22222222-2222-2222-2222-222222222222', 'document', '2024-03-10 10:00:00'),
       ('macro|user-1@test.com', '66666666-6666-6666-6666-666666666666', 'chat', '2024-03-09 10:00:00');

-- Insert frecency_aggregates for items WITH frecency
INSERT INTO public."frecency_aggregates" ("user_id", "entity_id", "entity_type", "frecency_score", "event_count", "first_event", "recent_events")
VALUES ('macro|user-1@test.com', '11111111-1111-1111-1111-111111111111', 'document', 100.0, 10, '2024-01-10 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', '22222222-2222-2222-2222-222222222222', 'document', 90.0, 8, '2024-01-11 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', '33333333-3333-3333-3333-333333333333', 'document', 80.0, 6, '2024-01-12 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', '66666666-6666-6666-6666-666666666666', 'chat', 70.0, 5, '2024-01-15 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', '77777777-7777-7777-7777-777777777777', 'chat', 60.0, 4, '2024-01-16 10:00:00', '[]'::jsonb);

SET session_replication_role = 'origin';
