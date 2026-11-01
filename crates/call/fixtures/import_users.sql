INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('019a0000-0000-7000-8000-000000000001', 'import-a', 'import-a@test.com', 'import-a'),
('019a0000-0000-7000-8000-000000000002', 'import-b', 'import-b@test.com', 'import-b');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|import-a@test.com', 'import-a@test.com', '019a0000-0000-7000-8000-000000000001'),
('macro|import-b@test.com', 'import-b@test.com', '019a0000-0000-7000-8000-000000000002');
