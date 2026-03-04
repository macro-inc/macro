INSERT INTO public."Organization" ("id","name")
(SELECT 1, 'organization-one');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|test@example.com', 'test@example.com','stripe_test');

INSERT INTO public."Project" ("id", "name", "userId")
VALUES ('project-123', 'Test Project', 'macro|test@example.com');
