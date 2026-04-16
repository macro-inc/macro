INSERT INTO public."Organization" ("id", "name")
        (SELECT 1, 'organization-one');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@test.com', 'user@test.com', 'stripe_id'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_id2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@test.com', 'user3@test.com', 'stripe_id3'),
       ('a4444444-4444-4444-4444-444444444444', 'user4@test.com', 'user4@test.com', 'stripe_id4'),
       ('a5555555-5555-5555-5555-555555555555', 'user5@test.com', 'user5@test.com', 'stripe_id5');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
        (SELECT 'macro|user@test.com', 'user@test.com', 'stripe_id', 1, 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
        (SELECT 'macro|user2@test.com', 'user2@test.com', 'stripe_id2', 1, 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
        (SELECT 'macro|user3@test.com', 'user3@test.com', 'stripe_id3', 1, 'a3333333-3333-3333-3333-333333333333');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
        (SELECT 'macro|user4@test.com', 'user4@test.com', 'stripe_id4', 'a4444444-4444-4444-4444-444444444444');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
        (SELECT 'macro|user5@test.com', 'user5@test.com', 'stripe_id5', 'a5555555-5555-5555-5555-555555555555');

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

-- Create macro_user records for test users
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a6666666-6666-6666-6666-666666666666', 'test-user', 'test-user@test.com', 'stripe_test-user'),
       ('a7777777-7777-7777-7777-777777777777', 'user0', 'user0@test.com', 'stripe_user0'),
       ('a8888888-8888-8888-8888-888888888888', 'uia_user1', 'uia_user1@test.com', 'stripe_uia_user1'),
       ('a9999999-9999-9999-9999-999999999999', 'uia_user2', 'uia_user2@test.com', 'stripe_uia_user2'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'uia_user3', 'uia_user3@test.com', 'stripe_uia_user3'),
       ('abbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'uia_user4', 'uia_user4@test.com', 'stripe_uia_user4'),
       ('accccccc-cccc-cccc-cccc-cccccccccccc', 'uia_user5', 'uia_user5@test.com', 'stripe_uia_user5')
ON CONFLICT (id) DO NOTHING;

-- Create test users needed for all UserItemAccess tests
INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('macro|test-user@test.com', 'test-user@test.com', 'a6666666-6666-6666-6666-666666666666'),
       ('macro|user0@test.com', 'user0@test.com', 'a7777777-7777-7777-7777-777777777777'),
       ('macro|user1@test.com', 'user1@test.com', 'a8888888-8888-8888-8888-888888888888'),
       ('macro|user2@test.com', 'user2@test.com', 'a9999999-9999-9999-9999-999999999999'),
       ('macro|user3@test.com', 'user3@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       ('macro|user4@test.com', 'user4@test.com', 'abbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
       ('macro|user5@test.com', 'user5@test.com', 'accccccc-cccc-cccc-cccc-cccccccccccc')
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
