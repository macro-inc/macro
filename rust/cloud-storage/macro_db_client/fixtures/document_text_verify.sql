INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-one', 'document two','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 1, 'This is a test document', 'document-one', 1000);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-two', 'document two','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 2, 'This is a test document', 'document-two', 1000);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-three', 'document three','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 3, 'This is a test document', 'document-three', 0);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-four', 'document two','pdf', 'macro|user@user.com');
