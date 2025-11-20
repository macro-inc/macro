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
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc A', 'txt', 'macro|user@user.com', '2024-01-01 10:00:00', '2024-01-02 11:00:00');

-- Document B: Newest created, oldest updated, middle viewed
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Doc B', 'pdf', 'macro|user@user.com', '2024-01-01 12:00:00', '2024-01-02 10:00:00');

-- Document C: Middle created, newest updated, oldest viewed
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Doc C', 'pdf', 'macro|user@user.com', '2024-01-01 11:00:00', '2024-01-02 12:00:00');

-- Instances (needed for the query to run)
INSERT INTO public."DocumentInstance" ("documentId", "sha")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-a'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha-b'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'sha-c');

-- Give the user access to all three documents
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES (gen_random_uuid(), 'macro|user@user.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'owner'),
       (gen_random_uuid(), 'macro|user@user.com', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'document', 'owner');

-- Create UserHistory entries with their own distinct ordering
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "updatedAt")
VALUES ('macro|user@user.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', '2024-01-03 12:00:00'), -- Newest viewed
       ('macro|user@user.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', '2024-01-03 11:00:00');
-- Doc C has no user_history entry
-- Oldest viewed

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';