-- This fixture creates one Document, one Chat, and one Project.
-- The timestamps are deliberately different for each item's createdAt, updatedAt,
-- and UserHistory updatedAt to test all three sorting methods independently.

-- Expected Order for CreatedAt:   Project, Chat, Document
-- Expected Order for UpdatedAt:   Chat, Document, Project
-- Expected Order for LastViewed:  Document, Project, Chat

SET session_replication_role = 'replica';

-- Base Setup
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Org', 'PILOT')
ON CONFLICT DO NOTHING;
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id', 1);

-- Item Creation with distinct timestamp orders
-- Project: Newest created, Oldest updated, Middle viewed
INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('test-project', 'Project Alpha', 'macro|user@user.com', '2024-01-03 10:00:00', '2024-02-01 10:00:00');

-- Chat: Middle created, Newest updated, Oldest viewed
INSERT INTO public."Chat" ("id", "userId", "name", "isPersistent", "createdAt", "updatedAt")
VALUES ('test-chat', 'macro|user@user.com', 'Chat Bravo', true, '2024-01-02 10:00:00', '2024-02-03 10:00:00');

-- Document: Oldest created, Middle updated, Newest viewed
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('test-document', 'Document Charlie', 'pdf', 'macro|user@user.com', '2024-01-01 10:00:00',
        '2024-02-02 10:00:00');

-- Dependencies
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'test-document');
INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
VALUES (1, 'test-document', 'sha-charlie');

-- User Access
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user@user.com', 'test-project', 'project', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', 'test-chat', 'chat', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', 'test-document', 'document', 'owner');

-- User History with its own distinct ordering
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user@user.com', 'test-document', 'document', '2024-03-03 10:00:00'), -- Newest viewed
       ('macro|user@user.com', 'test-project', 'project', '2024-03-02 10:00:00'),   -- Middle viewed
       ('macro|user@user.com', 'test-chat', 'chat', '2024-03-01 10:00:00'); -- Oldest viewed

SET session_replication_role = 'origin';