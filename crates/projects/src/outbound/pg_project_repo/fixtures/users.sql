INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
(SELECT 'a1111111-1111-1111-1111-111111111111', 'test@example.com', 'test@example.com', 'stripe_test');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|test@example.com', 'test@example.com','stripe_test','a1111111-1111-1111-1111-111111111111');
