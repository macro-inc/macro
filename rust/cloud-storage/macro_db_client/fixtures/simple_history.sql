INSERT INTO
  public."User" ("id", "email", "stripeCustomerId") (
    SELECT
      'macro|user@user.com',
      'user@user.com',
      'stripe_id'
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
      'document-one',
      'test_document_name',
      'txt',
      'macro|user@user.com',
      '2019-10-16 00:00:00',
      '2019-10-16 03:00:00' -- oldest should be last.
  );

INSERT INTO
  public."DocumentInstance" (
    "revisionName",
    "documentId",
    "createdAt",
    "updatedAt",
    "sha"
  ) (
    SELECT
      'test_document_name',
      'document-one',
      '2019-10-16 00:00:00',
      '2019-10-16 00:00:00',
      'sha'
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
      'document-two',
      'test_document_name',
      'pdf',
      'macro|user@user.com',
      '2019-10-16 00:10:00',
      '2019-10-16 02:00:00'
  );

INSERT INTO
  public."DocumentInstance" (
    "revisionName",
    "documentId",
    "createdAt",
    "updatedAt",
    "sha"
  ) (
    SELECT
      'test_document_name',
      'document-two',
      '2019-10-16 00:00:00',
      '2019-10-16 00:00:00',
      'sha'
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
      '2019-10-16 01:00:00'
  );

INSERT INTO
  public."DocumentInstance" (
    "revisionName",
    "documentId",
    "createdAt",
    "updatedAt",
    "sha"
  ) (
    SELECT
      'test_document_name',
      'document-three',
      '2019-10-16 00:30:00',
      '2019-10-16 00:30:00',
      'sha'
  );

INSERT INTO
  public."UserHistory" (
    "userId",
    "itemId",
    "itemType",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macro|user@user.com',
      'document-one',
      'document',
      '2019-10-16 00:00:00',
      '2019-10-16 00:00:00'
  );

INSERT INTO
  public."UserHistory" (
    "userId",
    "itemId",
    "itemType",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macro|user@user.com',
      'document-two',
      'document',
      '2019-10-16 00:00:00',
      '2019-10-16 00:10:00'
  );

INSERT INTO
  public."UserHistory" (
    "userId",
    "itemId",
    "itemType",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macro|user@user.com',
      'document-three',
      'document',
      '2019-10-16 00:00:00',
      '2019-10-16 00:20:00'
  );
