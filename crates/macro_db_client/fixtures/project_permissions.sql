INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id'),
       ('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@user.com', 'stripe_id2');
INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."Project" ("id","name","userId","parentId","createdAt","updatedAt")
(SELECT 'project-one', 'test_project_name','macro|user@user.com', NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'project-one', 'sp-1');

INSERT INTO public."Project" ("id","name","userId","parentId","createdAt","updatedAt")
(SELECT 'project-two', 'test_project_name','macro|user2@user.com', NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-2', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'project-two', 'sp-2');
