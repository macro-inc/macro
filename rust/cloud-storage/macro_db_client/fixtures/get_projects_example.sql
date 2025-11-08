INSERT INTO
    public."Project" ("id", "name", "userId", "createdAt", "updatedAt") (
        SELECT
            'p1',
            'a',
            'macro|user@user.com',
            '2019-10-16 00:00:00',
            '2019-10-16 00:00:00'
    );

INSERT INTO
    public."UserHistory" ("itemId", "itemType", "userId") (
        SELECT
            'p1',
            'project',
            'macro|user@user.com'
    );

INSERT INTO
    public."Project" ("id", "name", "userId", "createdAt", "updatedAt") (
        SELECT
            'pb1',
            'b',
            'macro|user@user.com',
            '2019-10-16 00:00:00',
            '2019-10-16 01:00:00'
    );

INSERT INTO
    public."UserHistory" ("itemId", "itemType", "userId") (
        SELECT
            'pb1',
            'project',
            'macro|user@user.com'
    );

-- Should be ignored
INSERT INTO
    public."Project" (
        "id",
        "name",
        "userId",
        "parentId",
        "createdAt",
        "updatedAt"
    ) (
        SELECT
            'p2',
            'a1',
            'macro|user2@user.com',
            'p1',
            '2019-10-16 00:00:00',
            '2019-10-16 02:00:00'
    );

INSERT INTO
    public."Project" ("id", "name", "userId", "parentId", "updatedAt") (
        SELECT
            'p11',
            'f1',
            'macro|user2@user.com',
            'p2',
            '2019-10-16 02:00:00'
    );

INSERT INTO
    public."UserHistory" ("itemId", "itemType", "userId") (
        SELECT
            'p11',
            'project',
            'macro|user@user.com'
    );

INSERT INTO
    public."Project" (
        "id",
        "name",
        "userId",
        "parentId",
        "createdAt",
        "updatedAt",
        "uploadPending",
        "uploadRequestId"
    ) (
        SELECT
            'p3',
            'a1',
            'macro|user@user.com',
            NULL,
            '2019-10-16 00:00:00',
            '2019-10-16 02:00:00',
            TRUE,
            'd50676e2-0a12-4c62-bc07-4b1cb6d8e9bc'
    );