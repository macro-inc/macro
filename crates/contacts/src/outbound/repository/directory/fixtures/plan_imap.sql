-- The shared seed creates this background owner's profile. Its IMAP contacts
-- do not overlap the main subject's directory, audience, or lookup ids.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-000000000003', 'macro|b1000@example.net', 'fa-imap', 'b1000@example.net', 'IMAP'),
('00000000-0000-4000-a000-000000000004', 'macro|b1000@example.net', 'fa-imap', 'b1000-two@example.net', 'IMAP');

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key)
SELECT 'macro|b1000@example.net', 'macro|z' || lpad(n::text, 6, '0') || '@example.net',
       '00000000-0000-4000-a000-000000000003'::uuid, 'imap'
FROM generate_series(1, 100000) n;

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key)
SELECT 'macro|b1000@example.net', 'macro|z' || lpad(n::text, 6, '0') || '@example.net',
       '00000000-0000-4000-a000-000000000004'::uuid, 'imap'
FROM generate_series(1, 10000) n;
