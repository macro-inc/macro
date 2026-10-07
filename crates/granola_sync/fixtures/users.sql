INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('019a0000-0000-7000-8000-000000000001', 'granola-a', 'granola-a@test.com', 'granola-a');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|granola-a@test.com', 'granola-a@test.com', '019a0000-0000-7000-8000-000000000001');
