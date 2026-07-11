INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'stripe_id2');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a3333333-3333-3333-3333-333333333333', 'user3@user.com', 'user3@user.com', 'stripe_id3');
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a5555555-5555-5555-5555-555555555555', 'user5@user.com', 'user5@user.com', 'stripe_id5');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id', 'a1111111-1111-1111-1111-111111111111');
INSERT INTO public."User" ("id","email","stripeCustomerId", "hasOnboardingDocuments","macro_user_id")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', TRUE, 'a2222222-2222-2222-2222-222222222222');
INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId","macro_user_id")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3', 1, 'a3333333-3333-3333-3333-333333333333');
INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user5@user.com', 'user5@user.com','stripe_id5', 'a5555555-5555-5555-5555-555555555555');
