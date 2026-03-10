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
