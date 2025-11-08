INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c1', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-chat1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'c1', 'sp-chat1');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c2', 'test-chat', 'macro|user2@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-chat2', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'c2', 'sp-chat2');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c3', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-chat3', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'c3', 'sp-chat3');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c4', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00','2019-10-16 01:01:00' );

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-chat4', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'c4', 'sp-chat4');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c5', 'test-chat', 'macro|user2@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-chat5', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'c5', 'sp-chat5');
