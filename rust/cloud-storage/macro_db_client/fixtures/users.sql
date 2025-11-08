INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');
INSERT INTO public."User" ("id","email","stripeCustomerId", "hasOnboardingDocuments")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2', TRUE);
INSERT INTO public."User" ("id","email","stripeCustomerId", "organizationId")
(SELECT 'macro|user3@user.com', 'user3@user.com','stripe_id3', 1);
INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user5@user.com', 'user5@user.com','stripe_id5');
