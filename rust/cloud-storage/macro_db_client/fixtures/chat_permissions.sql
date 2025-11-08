INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2');

INSERT INTO public."Chat" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'chat-one', 'test_chat_name','macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'chat-one', 'sp-1');

INSERT INTO public."Chat" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'chat-two', 'test_chat_name','macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-2', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'chat-two', 'sp-2');
