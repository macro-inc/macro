INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "sha", "createdAt", "updatedAt")
(SELECT 'test_document_name', 'document-one', 'sha-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "sha", "createdAt", "updatedAt")
(SELECT 'test_document_name', 'document-one', 'sha-two', '2019-10-16 01:00:00', '2019-10-16 01:00:00');
