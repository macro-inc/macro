-- Insert macro_user entries
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'stripe_id_2');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');

-- Insert users
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES ('macro|user2@user.com', 'user2@user.com', 'stripe_id_2', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id', 'a1111111-1111-1111-1111-111111111111');

-- Macro Prompts
INSERT INTO public."MacroPrompt" ("id", "title", "prompt", "icon", "color", "required_docs", "user_id", "created_at", "updated_at")
VALUES ('prompt-one', 'Test Prompt 1', 'This is a test prompt 1', 'icon1', 'red', NULL, 'macro|user2@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."MacroPrompt" ("id", "title", "prompt", "icon", "color", "required_docs", "user_id", "created_at", "updated_at")
VALUES ('prompt-two', 'Test Prompt 2', 'This is a test prompt 2', 'icon2', 'blue', 2, 'macro|user2@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."MacroPrompt" ("id", "title", "prompt", "icon", "color", "required_docs", "user_id", "created_at", "updated_at")
VALUES ('prompt-three', 'Test Prompt 3', 'This is a test prompt 3', 'icon3', 'green', 1, 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."MacroPrompt" ("id", "title", "prompt", "icon", "color", "required_docs", "user_id", "created_at", "updated_at")
VALUES ('prompt-four', 'Test Prompt 4', 'This is a test prompt 4', 'icon4', 'yellow', 5, 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."MacroPrompt" ("id", "title", "prompt", "icon", "color", "required_docs", "user_id", "created_at", "updated_at")
VALUES ('prompt-five', 'Test Prompt 5', 'This is a test prompt 5', 'icon5', 'yellow', NULL, 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
