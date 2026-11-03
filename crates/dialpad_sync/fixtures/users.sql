INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('019a0000-0000-7000-8000-0000000000d1', 'dialpad-a', 'dialpad-a@example.com', 'dialpad-a');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|dialpad-a@example.com', 'dialpad-a@example.com', '019a0000-0000-7000-8000-0000000000d1');
