-- This fixture is based on mixed_items_unexpanded.sql.
-- It adds UserHistory entries for some items to test sorting.

-- Disable foreign key constraints temporarily for easier setup
SET session_replication_role = 'replica';

---------------------------------
--  BASE SETUP (Same as the original fixture)
---------------------------------
INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT')
ON CONFLICT DO NOTHING;

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id', 1, 'a1111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Test Project', 'macro|user@user.com', '2023-01-17 12:00:00', '2023-01-17 12:00:00');
INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, 'dddddddd-dddd-dddd-dddd-dddddddddddd');
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt", "documentFamilyId",
                               "projectId")
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Test Document', 'pdf', 'macro|user@user.com', '2023-01-15 10:00:00', '2023-01-15 10:00:00', 1,
        'ffffffff-ffff-ffff-ffff-ffffffffffff');
INSERT INTO public."DocumentInstance" ("id", "revisionName", "documentId", "createdAt", "updatedAt", "sha")
VALUES (1, 'Test Document', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2023-01-15 10:00:00', '2023-01-15 10:00:00', 'abc123sha');
INSERT INTO public."Chat" ("id", "userId", "name", "createdAt", "updatedAt", "isPersistent", "projectId")
VALUES ('cccccccc-1111-1111-1111-111111111111', 'macro|user@user.com', 'Test Chat', '2023-01-16 11:00:00', '2023-01-16 11:00:00', true,
        'ffffffff-ffff-ffff-ffff-ffffffffffff');

-- Add user access to all items (Same as original)
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'document', 'macro|user@user.com', 'user', 'owner'),
       ('cccccccc-1111-1111-1111-111111111111', 'chat', 'macro|user@user.com', 'user', 'owner'),
       ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'project', 'macro|user@user.com', 'user', 'owner');

---------------------------------------------------
--  NEW: USER HISTORY DATA
---------------------------------------------------
-- Add history for the document and project to override their natural sort order.
-- 'test-chat' is intentionally omitted to test the fallback to its own updatedAt.
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES
-- Make the document the most recently viewed item
('macro|user@user.com', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'document', '2024-02-15 09:00:00', '2024-02-15 10:00:00'),
-- Make the project the second most recently viewed item
('macro|user@user.com', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'project', '2024-02-14 09:00:00', '2024-02-14 10:00:00');

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';