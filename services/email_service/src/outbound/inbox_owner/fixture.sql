INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('01900000-0000-7000-8000-000000000001', 'legacy_username', 'older@example.com', 'cus_older'),
('01900000-0000-7000-8000-000000000002', 'requester', 'requester@example.com', 'cus_requester');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|older@example.com', 'older@example.com', '01900000-0000-7000-8000-000000000001'),
('macro|requester@example.com', 'requester@example.com', '01900000-0000-7000-8000-000000000002');
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('01900000-0000-7000-8000-000000000003', 'macro|older@example.com', '01900000-0000-7000-8000-000000000001', 'older@example.com', 'GMAIL');
