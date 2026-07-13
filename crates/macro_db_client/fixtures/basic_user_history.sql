INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'stripe_id2');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a3333333-3333-3333-3333-333333333333', 'user3@user.com', 'user3@user.com', 'stripe_id3');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a4444444-4444-4444-4444-444444444444', 'user4@user.com', 'user4@user.com', 'stripe_id4');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a5555555-5555-5555-5555-555555555555', 'user5@user.com', 'user5@user.com', 'stripe_id5');

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 1, 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId","macro_user_id")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', 1, 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId","macro_user_id")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3', 1, 'a3333333-3333-3333-3333-333333333333');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user4@user.com', 'user4@user.com','stripe_id4', 'a4444444-4444-4444-4444-444444444444');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user5@user.com', 'user5@user.com','stripe_id5', 'a5555555-5555-5555-5555-555555555555');

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
