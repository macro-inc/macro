INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');
INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2');
INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3');
INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user5@user.com', 'user5@user.com','stripe_id5', 1);

INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-project1', false, 'view', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p1', 'sp-project1');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p2', 'a1', 'macro|user2@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project2', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p2', 'sp-project2');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'd1', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'p1');
INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'd1', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-document1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd1', 'sp-document1');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'd2', 'test_document_name','docx', 'macro|user2@user.com', '2019-10-16 00:10:00', '2019-10-16 00:10:00');
INSERT INTO public."DocumentBom" ("documentId", "createdAt", "updatedAt")
(SELECT 'd2', '2019-10-16 00:10:00', '2019-10-16 00:10:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-document2', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd2', 'sp-document2');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt", "projectId")
(SELECT 'c1', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00', 'p1');
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
