INSERT INTO public."Organization" ("id", "name")
        (SELECT 1, 'organization-one');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
        (SELECT 'macro|user@user.com', 'user@user.com', 'stripe_id', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
        (SELECT 'macro|user2@user.com', 'user2@user.com', 'stripe_id2', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
        (SELECT 'macro|user3@user.com', 'user3@user.com', 'stripe_id3', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId")
        (SELECT 'macro|user4@user.com', 'user4@user.com', 'stripe_id4');

INSERT INTO public."User" ("id", "email", "stripeCustomerId")
        (SELECT 'macro|user5@user.com', 'user5@user.com', 'stripe_id5');

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
    (SELECT 'document-one',
            'test_document_name',
            'pdf',
            'macro|user@user.com',
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
            'macro|user@user.com',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
    (SELECT 'test_document_name', 'document-two', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

-- Create test users needed for all UserItemAccess tests
INSERT INTO public."User" ("id", "email")
VALUES ('test-user', 'test-user@example.com'),
       ('user0', 'user0@example.com'),
       ('user1', 'user1@example.com'),
       ('user2', 'user2@example.com'),
       ('user3', 'user3@example.com'),
       ('user4', 'user4@example.com'),
       ('user5', 'user5@example.com')
ON CONFLICT (id) DO NOTHING;

-- Create single user item access record for test_delete_user_item_access
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'test-user', 'test-item', 'document', 'owner', NOW());

-- Create multiple user item access records for test_delete_user_item_access_by_item
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at")
VALUES ('00000000-0000-0000-0000-000000000002', 'user1', 'multi-access-item', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000003', 'user2', 'multi-access-item', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000004', 'user3', 'multi-access-item', 'document', 'view', NOW());

-- Create multiple user item access records for test_delete_user_item_access_bulk
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at")
VALUES ('00000000-0000-0000-0000-000000000005', 'user0', 'bulk-test-item-1', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000006', 'user1', 'bulk-test-item-1', 'document', 'edit', NOW()),
       ('00000000-0000-0000-0000-000000000007', 'user2', 'bulk-test-item-2', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000008', 'user3', 'bulk-test-item-2', 'document', 'edit', NOW()),
       ('00000000-0000-0000-0000-000000000009', 'user4', 'bulk-test-item-3', 'document', 'view', NOW()),
       ('00000000-0000-0000-0000-000000000010', 'user5', 'bulk-test-item-3', 'document', 'edit', NOW());