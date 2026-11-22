-- a and b have accounts; Mixed has a legacy-cased id; ghost's account is
-- gone but their inbox link and rows remain; outsider never had one.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000001', 'a', 'a@example.com', 'cus_orphan_a'),
('00000000-0000-4000-8000-000000000002', 'b', 'b@example.com', 'cus_orphan_b'),
('00000000-0000-4000-8000-000000000003', 'mixed', 'Mixed@example.com', 'cus_orphan_mixed');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|a@example.com', 'a@example.com', '00000000-0000-4000-8000-000000000001'),
('macro|b@example.com', 'b@example.com', '00000000-0000-4000-8000-000000000002'),
('macro|Mixed@example.com', 'Mixed@example.com', '00000000-0000-4000-8000-000000000003');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-000000000001', 'macro|ghost@example.com', 'fa-ghost', 'ghost@example.com', 'GMAIL');

INSERT INTO contact_list_members (user_id, contact_user_id, list_key) VALUES
('macro|a@example.com', 'macro|b@example.com', 'interacted'),
('macro|b@example.com', 'macro|a@example.com', 'interacted'),
('macro|a@example.com', 'macro|ghost@example.com', 'interacted'),
('macro|a@example.com', 'macro|ghost@example.com', 'invited'),
('macro|a@example.com', 'macro|outsider@example.org', 'invited'),
('macro|a@example.com', 'macro|mixed@example.com', 'interacted'),
('macro|mixed@example.com', 'macro|a@example.com', 'interacted'),
('macro|ghost@example.com', 'macro|a@example.com', 'interacted'),
('macro|ghost@example.com', 'macro|outsider@example.org', 'invited');

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key) VALUES
('macro|ghost@example.com', 'macro|a@example.com', '00000000-0000-4000-a000-000000000001', 'gmail'),
('macro|ghost@example.com', 'macro|outsider@example.org', '00000000-0000-4000-a000-000000000001', 'gmail');
