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
    public."User" ("id", "email", "stripeCustomerId") (
        SELECT
            'macro|user2@user.com',
            'user2@user.com',
            'stripe_id2'
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
    public."SharePermission" (
        "id",
        "isPublic",
        "publicAccessLevel",
        "createdAt",
        "updatedAt"
    ) (
        SELECT
            'sp-1',
            TRUE,
            'view',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00'
    );

INSERT INTO
    public."DocumentPermission" ("documentId", "sharePermissionId") (
        SELECT
            'document-one',
            'sp-1'
    );

INSERT INTO
    public."SharePermission" (
        "id",
        "isPublic",
        "publicAccessLevel",
        "createdAt",
        "updatedAt"
    ) (
        SELECT
            'sp-2',
            false,
            NULL,
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00'
    );

INSERT INTO
    public."DocumentPermission" ("documentId", "sharePermissionId") (
        SELECT
            'document-two',
            'sp-2'
    );

INSERT INTO
    public."Document" (
        "id",
        "name",
        "fileType",
        "owner",
        "createdAt",
        "updatedAt"
    ) (
        SELECT
            'document-three',
            'test_document_name',
            'pdf',
            'macro|user@user.com',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00'
    );

INSERT INTO
    public."Project" ("id", "name", "userId") (
        SELECT
            'new-project',
            'test_project_name',
            'macro|user@user.com'
    );

INSERT INTO
    public."Document" (
        "id",
        "name",
        "fileType",
        "owner",
        "createdAt",
        "updatedAt"
    ) (
        SELECT
            'document-four',
            'test_document_name',
            NULL,
            'macro|user@user.com',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00'
    );

INSERT INTO
    public."DocumentInstance" ("revisionName", "documentId", "sha") (
        SELECT
            'test_document_name',
            'document-four',
            'sha-four'
    );