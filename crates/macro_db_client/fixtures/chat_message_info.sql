INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com','stripe_id','a1111111-1111-1111-1111-111111111111');

INSERT INTO public."Chat" ("id","name","userId","model","createdAt","updatedAt","isPersistent")
VALUES
  ('chat-persistent', 'persistent chat', 'macro|user@user.com', 'gpt-4o', '2024-01-01 00:00:00', '2024-01-01 00:00:00', true),
  ('chat-ephemeral', 'ephemeral chat', 'macro|user@user.com', 'gpt-4o', '2024-01-01 00:00:00', '2024-01-01 00:00:00', false);

INSERT INTO public."ChatMessage" ("id","content","role","chatId")
VALUES
  ('msg-persistent', '"codebase brighter"', 'user', 'chat-persistent'),
  ('msg-ephemeral', '"another message"', 'user', 'chat-ephemeral');
