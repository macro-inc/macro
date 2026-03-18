INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'd1', 'test_document_name','txt', 'macro|user@user.com');

INSERT INTO public."Document" ("id","name","fileType", "owner", "deletedAt")
(SELECT 'd2', 'test_document_name','txt', 'macro|user@user.com', '2019-10-16 01:01:00');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c1', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'c2', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt", "deletedAt")
(SELECT 'c3', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00', '2019-10-16 01:01:10');
