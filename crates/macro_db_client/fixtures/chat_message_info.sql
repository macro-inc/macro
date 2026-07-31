INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com','stripe_id','a1111111-1111-1111-1111-111111111111');

INSERT INTO public."Chat" ("id","name","userId","model","createdAt","updatedAt","deletedAt","isPersistent")
VALUES
  ('chat-persistent', 'persistent chat', 'macro|user@user.com', 'gpt-4o', '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL, true),
  ('chat-ephemeral', 'ephemeral chat', 'macro|user@user.com', 'gpt-4o', '2024-02-01 00:00:00', '2024-02-01 00:00:00', NULL, false),
  ('chat-deleted', 'deleted chat', 'macro|user@user.com', 'gpt-4o', '2024-03-01 00:00:00', '2024-03-01 00:00:00', '2024-03-04 05:06:07.890', true);

INSERT INTO public."ChatMessage" ("id","content","role","chatId","createdAt","updatedAt")
VALUES
  ('msg-persistent', '"codebase brighter"', 'user', 'chat-persistent', '2024-01-02 03:04:05.123', '2024-01-03 04:05:06.789'),
  ('msg-ephemeral', '"another message"', 'assistant', 'chat-ephemeral', '2024-02-02 03:04:05.123', '2024-02-03 04:05:06.789'),
  ('msg-deleted', '"remove from search"', 'assistant', 'chat-deleted', '2024-03-02 03:04:05.123', '2024-03-03 04:05:06.789');
