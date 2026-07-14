INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentBom" ("revisionName", "documentId")
(SELECT 'test_document_name', 'document-one');

INSERT INTO public."UploadJob" ("id","jobId","jobType", "documentId")
(SELECT 1, 'job-id', 'job-type', 'document-one');
