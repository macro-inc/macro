INSERT INTO public."Organization" ("id", "name")
(SELECT 1, 'test-org');

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 1);

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3');

INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'project-one', 'b', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 04:00:00');

INSERT INTO public."Chat" ("id","name","userId", "model", "createdAt", "updatedAt")
(SELECT 'chat-one', 'test-chat', 'macro|user@user.com', 'gpt-4o', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-1', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
(SELECT 'chat-one', 'sp-1');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "sha")
(SELECT 'test_document_name', 'document-one', 'sha-one');

INSERT INTO public."DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
(SELECT 1, '{"testing": true}');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-two', 'test_document_name','pdf', 'macro|user@user.com');
