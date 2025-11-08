-- This fixture creates a project hierarchy with multiple items.
-- Timestamps are deliberately different for createdAt, updatedAt, and UserHistory.updatedAt
-- to test all three sorting methods for the EXPANDED (hierarchical) query.
-- One item ('chat-in-B') is intentionally given NO UserHistory entry to test the
-- 'viewed_at' filter.

-- Expected Order for CreatedAt:   doc-B, chat-A, doc-A
-- Expected Order for UpdatedAt:   chat-A, doc-A, doc-B
-- Expected Order for LastViewed:  doc-A, doc-B, chat-A (chat-B is filtered out)

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('macro|user-1@test.com', 'user@test.com', 'stripe_id_1', '1');

-- Project Hierarchy (A -> B)
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('project-A', 'Project A', 'macro|user-1@test.com', NULL, '2024-01-01 09:00:00', '2024-01-01 09:00:00'),
       ('project-B', 'Project B', 'macro|user-1@test.com', 'project-A', '2024-01-01 09:30:00', '2024-01-01 09:30:00');

-- Give user access to the top-level project to test hierarchical access
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user-1@test.com', 'project-A', 'project', 'owner');

-- Item Creation
-- Document A (in Project A): Oldest created, Middle updated, Newest viewed
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "createdAt", "updatedAt")
VALUES ('doc-A', 'Doc A', 'macro|user-1@test.com', 'project-A', '2024-01-10 10:00:00', '2024-02-11 10:00:00');

-- Chat A (in Project A): Middle created, Newest updated, Oldest viewed
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('chat-A', 'Chat A', 'macro|user-1@test.com', 'project-A', '2024-01-11 10:00:00', '2024-02-12 10:00:00');

-- Document B (in Project B): Newest created, Oldest updated, Middle viewed
INSERT INTO public."Document" ("id", "name", "owner", "projectId", "createdAt", "updatedAt")
VALUES ('doc-B', 'Doc B', 'macro|user-1@test.com', 'project-B', '2024-01-12 10:00:00', '2024-02-10 10:00:00');

-- Chat B (in Project B): Accessible, but has NO UserHistory entry.
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('chat-B', 'Chat B', 'macro|user-1@test.com', 'project-B', '2024-01-13 10:00:00', '2024-02-09 10:00:00');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'doc-A'),
       (2, 'doc-B');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'doc-A', 'sha-a'),
       (2, 'doc-B', 'sha-b');

-- User History with its own distinct ordering. Note that 'chat-B' is missing.
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user-1@test.com', 'doc-A', 'document', '2024-03-12 10:00:00'), -- Newest viewed
       ('macro|user-1@test.com', 'doc-B', 'document', '2024-03-11 10:00:00'), -- Middle viewed
       ('macro|user-1@test.com', 'chat-A', 'chat', '2024-03-10 10:00:00'); -- Oldest viewed

SET session_replication_role = 'origin';
