INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'test', 'test@test.com', 'stripe_id');

INSERT INTO
  public."User"
  ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES
  (
    'test-userid',
    'test@test.com',
    'stripe_id',
    'a1111111-1111-1111-1111-111111111111'
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
    'a0000000-0000-0000-0000-000000000000',
    'document-name-0',
    'md',
    'test-userid'
  ),
  (
    'a0000000-0000-0000-0000-000000000001',
    'document-name-1',
    'js',
    'test-userid'
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'document-name-2',
    'rs',
    'test-userid'
  ),
  (
    'a0000000-0000-0000-0000-00000000000a',
    'document-name-img',
    'png',
    'test-userid'
  ),
  (
    'a0000000-0000-0000-0000-00000000000b',
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
    "entity_type",
    "entity_id",
    "messageId"
  )
VALUES
  (
    'c0a0',
    'static_file',
    'a0000000-0000-0000-0000-00000000000a',
    'c0m0'
  ),
  (
    'c0a1',
    'document',
    'a0000000-0000-0000-0000-000000000000',
    'c0m0'
  ),
  (
    'c0a2',
    'document',
    'a0000000-0000-0000-0000-000000000000',
    'c0m1'
  ),
  (
    'c0a3',
    'document',
    'a0000000-0000-0000-0000-000000000001',
    'c0m1'
  ),
  (
    'c0a4',
    'document',
    'a0000000-0000-0000-0000-000000000002',
    'c0m1'
  ),
  (
    'c1a0',
    'document',
    'a0000000-0000-0000-0000-000000000000',
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
    'a0000000-0000-0000-0000-000000000000',
    'v0',
    '2025-06-10 00:00:00'
  ),
  (
    'd0v1-summary',
    'a0000000-0000-0000-0000-000000000000',
    'v1',
    '2025-06-11 00:00:00'
  ),
  (
    'd1v0-summary',
    'a0000000-0000-0000-0000-000000000001',
    'v0',
    '2025-06-12 00:00:00'
  );