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
VALUES ('project-A', 'Project A', 'macro|user-1@test.com', '2024-01-01 09:00:00', '2024-01-01 09:00:00');

-- Give user access to the project
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user-1@test.com', 'project-A', 'project', 'owner');

-- Create documents (3 with frecency, 2 without)
-- Documents WITH frecency (should be filtered out)
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "createdAt", "updatedAt")
VALUES ('doc-with-frecency-1', 'Doc With Frecency 1', 'macro|user-1@test.com', 'project-A', '2024-01-10 10:00:00', '2024-02-15 10:00:00'),
       ('doc-with-frecency-2', 'Doc With Frecency 2', 'macro|user-1@test.com', 'project-A', '2024-01-11 10:00:00', '2024-02-14 10:00:00'),
       ('doc-with-frecency-3', 'Doc With Frecency 3', 'macro|user-1@test.com', 'project-A', '2024-01-12 10:00:00', '2024-02-13 10:00:00');

-- Documents WITHOUT frecency (should be returned)
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "createdAt", "updatedAt")
VALUES ('doc-no-frecency-1', 'Doc No Frecency 1', 'macro|user-1@test.com', 'project-A', '2024-01-13 10:00:00', '2024-02-12 10:00:00'),
       ('doc-no-frecency-2', 'Doc No Frecency 2', 'macro|user-1@test.com', 'project-A', '2024-01-14 10:00:00', '2024-02-11 10:00:00');

-- Create chats (2 with frecency, 2 without)
-- Chats WITH frecency (should be filtered out)
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('chat-with-frecency-1', 'Chat With Frecency 1', 'macro|user-1@test.com', 'project-A', '2024-01-15 10:00:00', '2024-02-10 10:00:00'),
       ('chat-with-frecency-2', 'Chat With Frecency 2', 'macro|user-1@test.com', 'project-A', '2024-01-16 10:00:00', '2024-02-09 10:00:00');

-- Chats WITHOUT frecency (should be returned)
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('chat-no-frecency-1', 'Chat No Frecency 1', 'macro|user-1@test.com', 'project-A', '2024-01-17 10:00:00', '2024-02-08 10:00:00'),
       ('chat-no-frecency-2', 'Chat No Frecency 2', 'macro|user-1@test.com', 'project-A', '2024-01-18 10:00:00', '2024-02-07 10:00:00');

-- Dependencies for documents
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-with-frecency-1'),
       (2, 'doc-with-frecency-2'),
       (3, 'doc-with-frecency-3'),
       (4, 'doc-no-frecency-1'),
       (5, 'doc-no-frecency-2');

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'doc-with-frecency-1', 'sha-1'),
       (2, 'doc-with-frecency-2', 'sha-2'),
       (3, 'doc-with-frecency-3', 'sha-3'),
       (4, 'doc-no-frecency-1', 'sha-4'),
       (5, 'doc-no-frecency-2', 'sha-5');

-- User History entries for ordering tests
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user-1@test.com', 'doc-no-frecency-1', 'document', '2024-03-15 10:00:00'),
       ('macro|user-1@test.com', 'doc-no-frecency-2', 'document', '2024-03-14 10:00:00'),
       ('macro|user-1@test.com', 'chat-no-frecency-1', 'chat', '2024-03-13 10:00:00'),
       ('macro|user-1@test.com', 'chat-no-frecency-2', 'chat', '2024-03-12 10:00:00'),
       ('macro|user-1@test.com', 'doc-with-frecency-1', 'document', '2024-03-11 10:00:00'),
       ('macro|user-1@test.com', 'doc-with-frecency-2', 'document', '2024-03-10 10:00:00'),
       ('macro|user-1@test.com', 'chat-with-frecency-1', 'chat', '2024-03-09 10:00:00');

-- Insert frecency_aggregates for items WITH frecency
INSERT INTO public."frecency_aggregates" ("user_id", "entity_id", "entity_type", "frecency_score", "event_count", "first_event", "recent_events")
VALUES ('macro|user-1@test.com', 'doc-with-frecency-1', 'document', 100.0, 10, '2024-01-10 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', 'doc-with-frecency-2', 'document', 90.0, 8, '2024-01-11 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', 'doc-with-frecency-3', 'document', 80.0, 6, '2024-01-12 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', 'chat-with-frecency-1', 'chat', 70.0, 5, '2024-01-15 10:00:00', '[]'::jsonb),
       ('macro|user-1@test.com', 'chat-with-frecency-2', 'chat', 60.0, 4, '2024-01-16 10:00:00', '[]'::jsonb);

SET session_replication_role = 'origin';
