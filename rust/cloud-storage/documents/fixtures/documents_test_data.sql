INSERT INTO
    public."Organization" ("id", "name") (
        SELECT
            1,
            'organization-one'
    );

INSERT INTO
    public."User" (
        "id",
        "email",
        "stripeCustomerId",
        "organizationId"
    ) (
        SELECT
            'macro|user@user.com',
            'user@user.com',
            'stripe_id',
            1
    );

INSERT INTO
    public."Document" ("id", "name", "fileType", "owner") (
        SELECT
            'document-one',
            'test_document_name',
            'txt',
            'macro|user@user.com'
    );

INSERT INTO
    public."DocumentInstance" ("revisionName", "documentId", "sha") (
        SELECT
            'test_document_name',
            'document-one',
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
            'document-two',
            'test_document_name',
            'pdf',
            'macro|user@user.com'
    );

INSERT INTO
    public."DocumentBom" ("revisionName", "documentId") (
        SELECT
            'test_document_name',
            'document-two'
    );

INSERT INTO
    public."Project" ("id", "name", "userId") (
        SELECT
            'new-project',
            'test_project_name',
            'macro|user@user.com'
    );

-- Additional users for team sharing tests
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
    (SELECT 'macro|teammate1@user.com', 'teammate1@user.com', 'stripe_id_t1', 1);

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
    (SELECT 'macro|teammate2@user.com', 'teammate2@user.com', 'stripe_id_t2', 1);

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
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "created_at", "updated_at")
    VALUES ('b0000000-0000-0000-0000-000000000001', 'macro|user@user.com', 'document-one', 'document', 'owner', NOW(), NOW());

-- Share permissions for document-one
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
    (SELECT 'sp-doc-one', true, 'read', NOW(), NOW());

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
    (SELECT 'document-one', 'sp-doc-one');

-- Share permissions for document-two
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
    (SELECT 'sp-doc-two', false, NOW(), NOW());

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
    (SELECT 'document-two', 'sp-doc-two');
