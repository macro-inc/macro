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

INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType")
(SELECT 'macro|user@user.com', 'p1', 'project');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType")
(SELECT 'macro|user2@user.com', 'p1', 'project');
