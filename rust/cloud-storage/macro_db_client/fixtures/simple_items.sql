-- This fixture creates three documents with deliberately different timestamps for
-- `createdAt`, `updatedAt` (on the item), and `updatedAt` (in UserHistory)
-- to allow for testing all three sorting methods independently.

-- Expected Order for CreatedAt:   doc-B, doc-C, doc-A
-- Expected Order for UpdatedAt:   doc-C, doc-A, doc-B
-- Expected Order for LastViewed:  doc-A, doc-B, doc-C

-- Disable foreign key constraints temporarily
SET session_replication_role = 'replica';

INSERT INTO public."User" ("id", "email", "stripeCustomerId")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id');

-- Document A: Oldest created, middle updated, newest viewed
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('doc-A', 'Doc A', 'txt', 'macro|user@user.com', '2024-01-01 10:00:00', '2024-01-02 11:00:00');

-- Document B: Newest created, oldest updated, middle viewed
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('doc-B', 'Doc B', 'pdf', 'macro|user@user.com', '2024-01-01 12:00:00', '2024-01-02 10:00:00');

-- Document C: Middle created, newest updated, oldest viewed
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('doc-C', 'Doc C', 'pdf', 'macro|user@user.com', '2024-01-01 11:00:00', '2024-01-02 12:00:00');

-- Instances (needed for the query to run)
INSERT INTO public."DocumentInstance" ("documentId", "sha")
VALUES ('doc-A', 'sha-a'),
       ('doc-B', 'sha-b'),
       ('doc-C', 'sha-c');

-- Give the user access to all three documents
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user@user.com', 'doc-A', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', 'doc-B', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', 'doc-C', 'document', 'owner');

-- Create UserHistory entries with their own distinct ordering
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user@user.com', 'doc-A', 'document', '2024-01-03 12:00:00'), -- Newest viewed
       ('macro|user@user.com', 'doc-B', 'document', '2024-01-03 11:00:00');
-- Doc C has no user_history entry
-- Oldest viewed

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';