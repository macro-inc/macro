INSERT INTO public."Organization" ("id", "name")
        (SELECT 1, 'organization-one');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
        (SELECT 'macro|user@test.com', 'user@test.com', 'stripe_id', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
        (SELECT 'macro|user2@test.com', 'user2@test.com', 'stripe_id2', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
        (SELECT 'macro|user3@test.com', 'user3@test.com', 'stripe_id3', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId")
        (SELECT 'macro|user4@test.com', 'user4@test.com', 'stripe_id4');

INSERT INTO public."User" ("id", "email", "stripeCustomerId")
        (SELECT 'macro|user5@test.com', 'user5@test.com', 'stripe_id5');

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
    (SELECT 'document-one',
            'test_document_name',
            'pdf',
            'macro|user@test.com',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
    (SELECT 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
        (SELECT 'sp-document1', true, 'read');

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
    (SELECT 'document-two',
            'test_document_name',
            'pdf',
            'macro|user@test.com',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
    (SELECT 'test_document_name', 'document-two', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

-- Create test users needed for all UserItemAccess tests
INSERT INTO public."User" ("id", "email")
VALUES ('macro|test-user@test.com', 'test-user@test.com'),
       ('macro|user0@test.com', 'user0@test.com'),
       ('macro|user1@test.com', 'user1@test.com'),
       ('macro|user2@test.com', 'user2@test.com'),
       ('macro|user3@test.com', 'user3@test.com'),
       ('macro|user4@test.com', 'user4@test.com'),
       ('macro|user5@test.com', 'user5@test.com')
ON CONFLICT (id) DO NOTHING;

-- Create single user item access record for test_delete_user_item_access
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'macro|test-user@test.com', 'test-item', 'document', 'owner', NOW());

-- Create multiple user item access records for test_delete_user_item_access_by_item
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at")
VALUES ('00000000-0000-0000-0000-000000000002', 'macro|user1@test.com', 'multi-access-item', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000003', 'macro|user2@test.com', 'multi-access-item', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000004', 'macro|user3@test.com', 'multi-access-item', 'document', 'view', NOW());

-- Create multiple user item access records for test_delete_user_item_access_bulk
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at")
VALUES ('00000000-0000-0000-0000-000000000005', 'macro|user0@test.com', 'bulk-test-item-1', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000006', 'macro|user1@test.com', 'bulk-test-item-1', 'document', 'edit', NOW()),
       ('00000000-0000-0000-0000-000000000007', 'macro|user2@test.com', 'bulk-test-item-2', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000008', 'macro|user3@test.com', 'bulk-test-item-2', 'document', 'edit', NOW()),
       ('00000000-0000-0000-0000-000000000009', 'macro|user4@test.com', 'bulk-test-item-3', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000010', 'macro|user5@test.com', 'bulk-test-item-3', 'document', 'edit', NOW());
