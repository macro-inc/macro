INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user4@user.com', 'user4@user.com','stripe_id4');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user2@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user3@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');
