INSERT INTO
    public."Organization" ("id", "name") (
        SELECT
            1,
            'organization-one'
    );

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
    ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id'),
    ('a2222222-2222-2222-2222-222222222222', 'teammate1', 'teammate1@user.com', 'stripe_id_t1'),
    ('a3333333-3333-3333-3333-333333333333', 'teammate2', 'teammate2@user.com', 'stripe_id_t2');

INSERT INTO
    public."User" (
        "id",
        "email",
        "stripeCustomerId",
        "organizationId",
        "macro_user_id"
    ) (
        SELECT
            'macro|user@user.com',
            'user@user.com',
            'stripe_id',
            1,
            'a1111111-1111-1111-1111-111111111111'
    );

INSERT INTO
    public."Document" ("id", "name", "fileType", "owner") (
        SELECT
            'd0000000-0000-0000-0000-000000000001',
            'test_document_name',
            'txt',
            'macro|user@user.com'
    );

INSERT INTO
    public."DocumentInstance" ("revisionName", "documentId", "sha") (
        SELECT
            'test_document_name',
            'd0000000-0000-0000-0000-000000000001',
            'sha-one'
    );

INSERT INTO
    public."DocumentInstanceModificationData" ("documentInstanceId", "modificationData") (
        SELECT
            1,
            '{"testing": true}'
    );

INSERT INTO
    public."Document" ("id", "name", "fileType", "owner") (
        SELECT
            'd0000000-0000-0000-0000-000000000002',
            'test_document_name',
            'pdf',
            'macro|user@user.com'
    );

INSERT INTO
    public."DocumentBom" ("revisionName", "documentId") (
        SELECT
            'test_document_name',
            'd0000000-0000-0000-0000-000000000002'
    );

INSERT INTO
    public."Project" ("id", "name", "userId") (
        SELECT
            'd0000000-0000-0000-0000-100000000001',
            'test_project_name',
            'macro|user@user.com'
    );

-- Additional users for team sharing tests
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
    (SELECT 'macro|teammate1@user.com', 'teammate1@user.com', 'stripe_id_t1', 1, 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
    (SELECT 'macro|teammate2@user.com', 'teammate2@user.com', 'stripe_id_t2', 1, 'a3333333-3333-3333-3333-333333333333');

-- A user that belongs to no team (team-share edge case tests)
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
    ('a4444444-4444-4444-4444-444444444444', 'noteam', 'no-team@user.com', 'stripe_id_nt');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
    (SELECT 'macro|no-team@user.com', 'no-team@user.com', 'stripe_id_nt', 1, 'a4444444-4444-4444-4444-444444444444');

-- Team and team_user for sharing tests
INSERT INTO public."team" ("id", "name", "owner_id")
    VALUES ('a0000000-0000-0000-0000-000000000001', 'test-team', 'macro|user@user.com');

INSERT INTO public."team_user" ("user_id", "team_id", "team_role")
    VALUES ('macro|user@user.com', 'a0000000-0000-0000-0000-000000000001', 'owner');

INSERT INTO public."team_user" ("user_id", "team_id", "team_role")
    VALUES ('macro|teammate1@user.com', 'a0000000-0000-0000-0000-000000000001', 'member');

INSERT INTO public."team_user" ("user_id", "team_id", "team_role")
    VALUES ('macro|teammate2@user.com', 'a0000000-0000-0000-0000-000000000001', 'member');

-- Owner access for document-one (used in share_with_team tests)
INSERT INTO public.entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('d0000000-0000-0000-0000-000000000001', 'document', 'macro|user@user.com', 'user', 'owner');

-- Share permissions for document-one
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
    (SELECT 'sp-doc-one', true, 'read', NOW(), NOW());

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
    (SELECT 'd0000000-0000-0000-0000-000000000001', 'sp-doc-one');

-- Channel and participants for channel share permission tests
INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'test-channel', 'private', 'macro|user@user.com');

INSERT INTO comms_channel_participants (user_id, channel_id, role) VALUES
    ('macro|user@user.com', 'c0000000-0000-0000-0000-000000000001', 'owner'),
    ('macro|teammate1@user.com', 'c0000000-0000-0000-0000-000000000001', 'member'),
    ('macro|teammate2@user.com', 'c0000000-0000-0000-0000-000000000001', 'member');

-- Share permissions for document-two
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
    (SELECT 'sp-doc-two', false, NOW(), NOW());

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
    (SELECT 'd0000000-0000-0000-0000-000000000002', 'sp-doc-two');

-- Document inside test project (for get_project_children tests)
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "projectId") (
    SELECT
        'd0000000-0000-0000-0000-000000000003',
        'project_child_doc',
        'txt',
        'macro|user@user.com',
        'd0000000-0000-0000-0000-100000000001'
);

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "sha") (
    SELECT 'project_child_doc', 'd0000000-0000-0000-0000-000000000003', 'sha-three'
);

INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
    (SELECT 'sp-doc-three', false, NOW(), NOW());

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
    (SELECT 'd0000000-0000-0000-0000-000000000003', 'sp-doc-three');

-- Sub-project inside test project (for get_project_children tests)
INSERT INTO public."Project" ("id", "name", "userId", "parentId") (
    SELECT
        'd0000000-0000-0000-0000-100000000002',
        'child_project',
        'macro|user@user.com',
        'd0000000-0000-0000-0000-100000000001'
);

-- Deleted document inside test project (should be excluded from children)
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "projectId", "deletedAt") (
    SELECT
        'd0000000-0000-0000-0000-000000000004',
        'deleted_project_doc',
        'txt',
        'macro|user@user.com',
        'd0000000-0000-0000-0000-100000000001',
        NOW()
);

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "sha") (
    SELECT 'deleted_project_doc', 'd0000000-0000-0000-0000-000000000004', 'sha-four'
);
