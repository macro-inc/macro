INSERT INTO
  public."User" ("id", "email", "stripeCustomerId") (
    SELECT
      'macro|user@user.com',
      'user@user.com',
      'stripe_id'
  );

INSERT INTO
  public."Document" ("id", "name", "fileType", "owner") (
    SELECT
      'document-one',
      'test_document_name',
      'pdf',
      'macro|user@user.com'
  );

INSERT INTO
  "DocumentProcessResult" ("id", "documentId", "jobType", "content")
VALUES
  (
    1,
    'document-one',
    'pdf_split_texts',
    '{"id": "test-1"}'
  );
