-- Create a test user
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id');

INSERT INTO
  public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES (
  'macro|user@user.com',
  'user@user.com',
  'stripe_id',
  'a1111111-1111-1111-1111-111111111111'
);

-- Create test documents
INSERT INTO
  public."Document" (
    "id",
    "name",
    "fileType",
    "owner",
    "createdAt",
    "updatedAt"
  ) 
VALUES 
  (
    'document-one',
    'test_document_one',
    'txt',
    'macro|user@user.com',
    '2019-10-16 00:00:00',
    '2019-10-16 00:00:00'
  ),
  (
    'document-two',
    'test_document_two',
    'pdf',
    'macro|user@user.com',
    '2019-10-16 01:00:00',
    '2019-10-16 01:00:00'
  ),
  (
    'no-insight-document',
    'no_insight_document',
    'txt',
    'macro|user@user.com',
    '2019-10-16 02:00:00',
    '2019-10-16 02:00:00'
  );

-- Insert a sample DocumentInsight
INSERT INTO
  public."DocumentSummary" (
    "document_id",
    "summary",
    "version_id"
  )
VALUES 
  (
    'document-one',
    'This is a test document summary',
    'version-0'
  ); 


INSERT INTO
  public."DocumentSummary" (
    "document_id",
    "summary",
    "version_id"
  )
VALUES
  (
    'document-one',
    'This is a test document summary',
    'test-hash-123'
  ),
  (
    'document-one',
    'This is a test document summary',
    'test-hash-123'
  );

INSERT INTO
  public."DocumentSummary"(
    "id",
    "document_id",
    "summary",
    "version_id"
  )
VALUES
  (
    'delete-one',
    'document-one',
    'This is a test document summary',
    'test-hash-123'
  ),
  (
    'delete-two',
    'document-one',
    'This is a test document summary',
    'test-hash-123'
  );
