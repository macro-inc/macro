INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 1);

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', 1);

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3', 1);

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user4@user.com', 'user4@user.com','stripe_id4');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user5@user.com', 'user5@user.com','stripe_id5');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-document1', true, 'read');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-two', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-two', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');
