INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id'),
       ('a2222222-2222-2222-2222-222222222222', 'other', 'other@user.com', 'stripe_iddfkjdfkdf');
INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');
INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
VALUES ('macro|other@user.com', 'other@user.com','stripe_iddfkjdfkdf', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."Project" ("id","name", "userId", "createdAt", "updatedAt")
VALUES ('project-one', 'test_project_name', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES ('share-permission-one', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES ('project-one', 'share-permission-one');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
VALUES ('macro|user@user.com', 'project-one', 'project', 0, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

-- Create project two with permissions
INSERT INTO public."Project" ("id","name", "userId", "createdAt", "updatedAt")
VALUES ('project-two', 'test_project_name', 'macro|other@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES ('share-permission-two', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES ('project-two', 'share-permission-two');
