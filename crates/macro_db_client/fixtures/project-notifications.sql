INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
    ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id'),
    ('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@user.com', 'stripe_id2');

INSERT INTO
  public."User" ("id", "email", "stripeCustomerId", "macro_user_id") (
    SELECT
      'macro|user@user.com',
      'user@user.com',
      'stripe_id',
      'a1111111-1111-1111-1111-111111111111'
  );

INSERT INTO
  public."User" ("id", "email", "stripeCustomerId", "macro_user_id") (
    SELECT
      'macro|user2@user.com',
      'user2@user.com',
      'stripe_id2',
      'a2222222-2222-2222-2222-222222222222'
  );

INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType")
(SELECT 'macro|user@user.com', 'p1', 'project');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType")
(SELECT 'macro|user2@user.com', 'p1', 'project');
