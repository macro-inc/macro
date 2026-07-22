INSERT INTO public."macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'owner@test.com', 'owner@test.com', 'stripe-owner'),
    ('a2222222-2222-2222-2222-222222222222', 'viewer@test.com', 'viewer@test.com', 'stripe-viewer');

INSERT INTO public."User" (id, email, "stripeCustomerId", macro_user_id)
VALUES
    ('macro|owner@test.com', 'owner@test.com', 'stripe-owner', 'a1111111-1111-1111-1111-111111111111'),
    ('macro|viewer@test.com', 'viewer@test.com', 'stripe-viewer', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."Project"
    (id, name, "userId", "parentId", "createdAt", "updatedAt", "deletedAt", "uploadPending", "uploadRequestId")
VALUES
    ('10000000-0000-0000-0000-000000000001', 'Root', 'macro|owner@test.com', NULL, '2024-01-01', '2024-01-05', NULL, false, NULL),
    ('10000000-0000-0000-0000-000000000002', 'First child', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000001', '2024-01-02', '2024-01-02', NULL, false, NULL),
    ('10000000-0000-0000-0000-000000000003', 'Grandchild', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000002', '2024-01-03', '2024-01-03', NULL, false, NULL),
    ('10000000-0000-0000-0000-000000000004', 'Deleted child', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000001', '2024-01-04', '2024-01-04', '2024-02-01', false, NULL),
    ('10000000-0000-0000-0000-000000000005', 'Shared history', 'macro|owner@test.com', NULL, '2024-01-05', '2024-01-06', NULL, false, NULL),
    ('10000000-0000-0000-0000-000000000006', 'Owner pending', 'macro|owner@test.com', NULL, '2024-01-06', '2024-01-07', NULL, true, 'request-owner'),
    ('10000000-0000-0000-0000-000000000007', 'Viewer pending', 'macro|viewer@test.com', NULL, '2024-01-07', '2024-01-08', NULL, true, 'request-viewer'),
    ('10000000-0000-0000-0000-000000000008', 'Nested pending', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000006', '2024-01-08', '2024-01-09', NULL, true, 'request-owner'),
    ('10000000-0000-0000-0000-000000000009', 'Deleted root', 'macro|owner@test.com', NULL, '2024-01-09', '2024-01-10', '2024-02-02', false, NULL);

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType")
VALUES
    ('macro|viewer@test.com', '10000000-0000-0000-0000-000000000001', 'project'),
    ('macro|viewer@test.com', '10000000-0000-0000-0000-000000000005', 'project'),
    ('macro|viewer@test.com', '10000000-0000-0000-0000-000000000006', 'project'),
    ('macro|viewer@test.com', '10000000-0000-0000-0000-000000000009', 'project');

INSERT INTO public."SharePermission" (id, "isPublic", "publicAccessLevel")
VALUES ('share-root', true, 'edit');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES ('10000000-0000-0000-0000-000000000001', 'share-root');
INSERT INTO public."ChannelSharePermission" (share_permission_id, channel_id, access_level)
VALUES ('share-root', 'channel-one', 'view');

INSERT INTO public."Document" (id, name, "fileType", owner, "projectId", "createdAt", "updatedAt", "deletedAt")
VALUES
    ('20000000-0000-0000-0000-000000000001', 'Document', 'pdf', 'macro|viewer@test.com', '10000000-0000-0000-0000-000000000001', '2024-01-03', '2024-01-03', NULL),
    ('20000000-0000-0000-0000-000000000002', 'Deleted document', 'pdf', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000001', '2024-01-04', '2024-01-04', '2024-02-01');
INSERT INTO public."DocumentInstance" ("documentId", "revisionName", sha, "createdAt", "updatedAt")
VALUES
    ('20000000-0000-0000-0000-000000000001', 'Document', 'sha-one', '2024-01-03', '2024-01-03'),
    ('20000000-0000-0000-0000-000000000002', 'Deleted document', 'sha-two', '2024-01-04', '2024-01-04');

INSERT INTO public."Chat" (id, name, "userId", "projectId", "createdAt", "updatedAt", "deletedAt")
VALUES
    ('30000000-0000-0000-0000-000000000001', 'Chat', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000001', '2024-01-04', '2024-01-04', NULL),
    ('30000000-0000-0000-0000-000000000002', 'Deleted chat', 'macro|owner@test.com', '10000000-0000-0000-0000-000000000001', '2024-01-05', '2024-01-05', '2024-02-01');

INSERT INTO public.entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'project', 'macro|owner@test.com', 'user', 'owner'),
    ('10000000-0000-0000-0000-000000000001', 'project', 'macro|viewer@test.com', 'user', 'view'),
    ('20000000-0000-0000-0000-000000000001', 'document', 'macro|viewer@test.com', 'user', 'owner'),
    ('30000000-0000-0000-0000-000000000001', 'chat', 'macro|owner@test.com', 'user', 'owner');
