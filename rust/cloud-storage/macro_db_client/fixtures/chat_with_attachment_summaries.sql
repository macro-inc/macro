INSERT INTO
  public."User"
  ("id", "email", "stripeCustomerId")
VALUES
  (
    'test-userid',
    'test@test.com',
    'stripe_id'
  );

INSERT INTO 
  public."Document"
  (
  "id",
  "name",
  "fileType",
  "owner"
  )
VALUES
  (
    'document-id-0',
    'document-name-0',
    'md',
    'test-userid'
  ),
  (
    'document-id-1',
    'document-name-1',
    'js',
    'test-userid'
  ),
  (
    'document-id-2',
    'document-name-2',
    'rs',
    'test-userid'
  ),
  (
    'document-id-img',
    'document-name-img',
    'png',
    'test-userid'
  ),
  (
    'document-id-never',
    'document-name-never',
    'sql',
    'test-userid'
  );

INSERT INTO 
  public."Chat"
  (
  "id",
  "userId",
  "name"
  )
VALUES
  (
    'chat-id-0',
    'test-userid',
    'chat-name-0'
  ),
  (
    'chat-id-1',
    'test-userid',
    'chat-name-1'
  ),
  (
    'chat-id-empty',
    'test-userid',
    'chat-name-empty'
  );

INSERT INTO 
  public."ChatMessage" (
    "id",
    "content",
    "role",
    "chatId",
    "createdAt"
  )
VALUES
-- chat 0 -- 
  (
    'c0m0',
    '"m0-content"',
    'user',
    'chat-id-0',
    '2019-10-16 00:00:00'
  ),
  (
    'c0m1',
    '"m1-content"',
    'assistant',
    'chat-id-0',
    '2019-10-17 00:00:00'
  ),
  (
    'c0m2',
    '"m2-content"',
    'user',
    'chat-id-0',
    '2019-10-18 00:00:00'
  ),
-- chat 1 --
  (
    'c1m0',
    '"m0-content"',
    'user',
    'chat-id-1',
    '2019-10-16 00:00:00'
  ),
  (
    'c1m1',
    '"m1-content"',
    'assistant',
    'chat-id-1',
    '2019-10-17 00:00:00'
  );


-- attachments --
INSERT INTO 
  public."ChatAttachment"
  (
    "id",
    "attachmentType",
    "attachmentId",
    "messageId"
  )
VALUES
  (
    'c0a0',
    'image',
    'document-id-img',
    'c0m0'
  ),
  (
    'c0a1',
    'document',
    'document-id-0',
    'c0m0'
  ),
  (
    'c0a2',
    'document',
    'document-id-0',
    'c0m1'
  ),
  (
    'c0a3',
    'document',
    'document-id-1',
    'c0m1'
  ),
  (
    'c0a4',
    'document',
    'document-id-2',
    'c0m1'
  ),
  (
    'c1a0',
    'document',
    'document-id-0',
    'c0m1'
  );

INSERT INTO 
  public."DocumentSummary" (
    "summary",
    "document_id",
    "version_id",
    "createdAt"
  )
VALUES
  (
    'd0v0-summary',
    'document-id-0',
    'v0',
    '2025-06-10 00:00:00'
  ),
  (
    'd0v1-summary',
    'document-id-0',
    'v1',
    '2025-06-11 00:00:00'
  ),
  (
    'd1v0-summary',
    'document-id-1',
    'v0',
    '2025-06-12 00:00:00'
  );