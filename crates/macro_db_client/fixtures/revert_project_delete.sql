INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'stripe_id2');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', 'a2222222-2222-2222-2222-222222222222');

-- Should have user history for user
INSERT INTO public."Project" ("id", "name", "userId", "deletedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00');

-- Should have user history for user
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "deletedAt")
(SELECT 'p2', 'b', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00');

-- Should have user history for user2
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "deletedAt")
(SELECT 'p3', 'c', 'macro|user2@user.com', 'p2', '2019-10-16 00:00:00');

-- Should have user history for user
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt", "projectId")
(SELECT 'd1', 'd1', 'docx', 'macro|user@user.com', '2019-10-16 00:00:00', 'p1');

-- Should have user history for user2
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt", "projectId")
(SELECT 'd2', 'd2', 'docx', 'macro|user2@user.com', '2019-10-16 00:00:00', 'p2');

-- Should not be reverted as it's not deleted
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "projectId")
(SELECT 'd3', 'd3', 'docx', 'macro|user@user.com', 'p3');

-- Should have user history for user
INSERT INTO public."Chat" ("id", "name", "userId", "deletedAt", "projectId")
(SELECT 'c1', 'c1', 'macro|user@user.com', '2019-10-16 00:00:00', 'p1');

-- Should have user history for user2
INSERT INTO public."Chat" ("id", "name", "userId", "deletedAt", "projectId")
(SELECT 'c2', 'c2', 'macro|user2@user.com', '2019-10-16 00:00:00', 'p2');

-- Should not be reverted as it's not deleted
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
(SELECT 'c3', 'c3', 'macro|user@user.com', 'p3');
