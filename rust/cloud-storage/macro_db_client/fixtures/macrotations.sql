INSERT INTO
  public."User" ("id", "email", "stripeCustomerId") (
    SELECT
      'macro|user@user.com',
      'user@user.com',
      'stripe_id'
  );

INSERT INTO
  public."User" ("id", "email", "stripeCustomerId") (
    SELECT
      'macro|user2@user.com',
      'user2@user.com',
      'stripe_id2'
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
      'pdf',
      'macro|user@user.com',
      '2019-10-16 00:00:00',
      '2019-10-16 00:00:00'
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
      'macro|user2@user.com',
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
      '2019-10-16 00:00:00'
  );

INSERT INTO
  public."Macrotation" (
    "id",
    "documentId",
    "userId",
    "linkSharePosition",
    "highlightedText",
    "image",
    "comment",
    "hexCode",
    "section",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macrotation-one',
      'document-one',
      'macro|user@user.com',
      'lsp',
      'highlighted text',
      'image',
      'comment',
      'hex code',
      'section',
      '2019-10-16 00:00:00',
      '2019-10-16 00:00:00'
  );

INSERT INTO
  public."Macrotation" (
    "id",
    "documentId",
    "userId",
    "linkSharePosition",
    "highlightedText",
    "image",
    "comment",
    "hexCode",
    "section",
    "createdAt",
    "updatedAt",
    "parentId"
  ) (
    SELECT
      'macrotation-two',
      'document-one',
      'macro|user@user.com',
      'lsp',
      'highlighted text',
      'image',
      'comment',
      'hex code',
      'section',
      '2019-10-16 00:00:00',
      '2019-10-16 00:01:00',
      'macrotation-one'
  );

INSERT INTO
  public."Macrotation" (
    "id",
    "documentId",
    "userId",
    "linkSharePosition",
    "highlightedText",
    "image",
    "comment",
    "hexCode",
    "section",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macrotation-three',
      'document-one',
      'macro|user@user.com',
      'lsp',
      'highlighted text',
      'image',
      'comment',
      'hex code',
      'section',
      '2019-10-16 00:00:00',
      '2019-10-16 00:03:00'
  );

INSERT INTO
  public."Macrotation" (
    "id",
    "documentId",
    "userId",
    "linkSharePosition",
    "highlightedText",
    "image",
    "comment",
    "hexCode",
    "section",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macrotation-four',
      'document-one',
      'macro|user@user.com',
      'lsp',
      'highlighted text',
      'image',
      'comment',
      'hex code',
      'section',
      '2019-10-16 00:00:00',
      '2019-10-16 00:04:00'
  );

INSERT INTO
  public."Macrotation" (
    "id",
    "documentId",
    "userId",
    "linkSharePosition",
    "highlightedText",
    "image",
    "comment",
    "hexCode",
    "section",
    "createdAt",
    "updatedAt"
  ) (
    SELECT
      'macrotation-five',
      'document-two',
      'macro|user2@user.com',
      'lsp',
      'highlighted text',
      'image',
      'comment',
      'hex code',
      'section',
      '2019-10-16 00:00:00',
      '2019-10-16 00:05:00'
  );
