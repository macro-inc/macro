-- SQL fixture for update_missing_contact_names tests
-- Seeds contacts with and without names across two links

------------------------------------------------------------
-- Common: links
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001a', 'macro|user_a@example.com', '00000000-0000-0000-0000-00000000001a',
        'user_a@example.com', 'GMAIL', true, '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001b', 'macro|user_b@example.com', '00000000-0000-0000-0000-00000000001b',
        'user_b@example.com', 'GMAIL', true, '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

------------------------------------------------------------
-- Link A contacts
------------------------------------------------------------

-- Contact with a name (should NOT be updated)
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0001',
        '00000000-0000-0000-0000-00000000001a',
        'hasname@example.com',
        'Already Has Name',
        '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

-- Contact without a name (should be updated)
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0002',
        '00000000-0000-0000-0000-00000000001a',
        'noname@example.com',
        NULL,
        '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

-- Another contact without a name
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0003',
        '00000000-0000-0000-0000-00000000001a',
        'noname2@example.com',
        NULL,
        '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');
