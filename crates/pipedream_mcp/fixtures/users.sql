INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('019a0000-0000-7000-8000-000000000011', 'pipedream-owner', 'owner@example.com', 'pipedream-owner');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|owner@example.com', 'owner@example.com', '019a0000-0000-7000-8000-000000000011');
