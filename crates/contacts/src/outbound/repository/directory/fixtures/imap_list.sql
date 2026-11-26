INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-000000000004', 'macro|v@example.com', 'fa-v', 'v-imap@example.com', 'IMAP'),
('00000000-0000-4000-a000-000000000005', 'macro|v@example.com', 'fa-v', 'v-imap-two@example.com', 'IMAP'),
('00000000-0000-4000-a000-000000000006', 'macro|g@example.com', 'fa-g', 'g-imap@example.com', 'IMAP');

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key) VALUES
('macro|v@example.com', 'macro|a@example.com', '00000000-0000-4000-a000-000000000004', 'imap'),
('macro|v@example.com', 'macro|a@example.com', '00000000-0000-4000-a000-000000000005', 'imap'),
('macro|v@example.com', 'macro|d@example.com', '00000000-0000-4000-a000-000000000004', 'imap'),
('macro|g@example.com', 'macro|x@example.com', '00000000-0000-4000-a000-000000000006', 'imap');
