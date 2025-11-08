-- Insert users 
INSERT INTO public."User" ("id", "email", "stripeCustomerId")
VALUES ('macro|user2@user.com', 'user2@user.com', 'stripe_id_2');

INSERT INTO public."User" ("id", "email", "stripeCustomerId")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id');

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
