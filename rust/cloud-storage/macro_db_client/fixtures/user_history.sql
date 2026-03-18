INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'stripe_id2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@user.com', 'user3@user.com', 'stripe_id3'),
       ('a4444444-4444-4444-4444-444444444444', 'user4@user.com', 'user4@user.com', 'stripe_id4');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3', 'a3333333-3333-3333-3333-333333333333');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user4@user.com', 'user4@user.com','stripe_id4', 'a4444444-4444-4444-4444-444444444444');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user2@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user3@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');
