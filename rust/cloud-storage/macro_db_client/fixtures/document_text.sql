INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-one', 'test_document_name','txt', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id","content","documentId","tokenCount")
(SELECT 1, 'test document text', 'document-one', 1);
