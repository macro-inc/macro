INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id');
INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

-- Create a nested project hierarchy: Root -> Level1 -> Level2 -> Level3
INSERT INTO public."Project" ("id","name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('root-project', 'Root Project', 'macro|user@user.com', NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."Project" ("id","name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('level1-project', 'Level 1', 'macro|user@user.com', 'root-project', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."Project" ("id","name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('level2-project', 'Level 2', 'macro|user@user.com', 'level1-project', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."Project" ("id","name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('level3-project', 'Level 3', 'macro|user@user.com', 'level2-project', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

-- Create another branch: Root -> Alt Level 1
INSERT INTO public."Project" ("id","name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('alt-level1-project', 'Alt Branch', 'macro|user@user.com', 'root-project', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

-- Create a standalone project (no parent)
INSERT INTO public."Project" ("id","name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('standalone-project', 'Standalone', 'macro|user@user.com', NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');
