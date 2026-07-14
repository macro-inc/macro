-- SQL fixture for insert_new_contacts and fetch_contacts_by_emails tests
-- This file seeds:
-- - 1 email link
-- - Pre-existing contacts for testing fetch and conflict handling

------------------------------------------------------------
-- Common: links
------------------------------------------------------------

-- Link A: user email is user_a@example.com
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001a', 'macro|user_a@example.com', '00000000-0000-0000-0000-00000000001a',
        'user_a@example.com', 'GMAIL', true, '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

-- Link B: different user for isolation tests
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001b', 'macro|user_b@example.com', '00000000-0000-0000-0000-00000000001b',
        'user_b@example.com', 'GMAIL', true, '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

------------------------------------------------------------
-- Pre-existing contacts for Link A
------------------------------------------------------------

-- Contact 1: existing contact to test fetch
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0001',
        '00000000-0000-0000-0000-00000000001a',
        'existing1@example.com',
        'Existing Contact One',
        NOW(),
        NOW());

-- Contact 2: existing contact to test fetch with multiple emails
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0002',
        '00000000-0000-0000-0000-00000000001a',
        'existing2@example.com',
        'Existing Contact Two',
        NOW(),
        NOW());

-- Contact 3: existing contact with no name
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0003',
        '00000000-0000-0000-0000-00000000001a',
        'noname@example.com',
        NULL,
        NOW(),
        NOW());

------------------------------------------------------------
-- Pre-existing contact for Link B (to test link isolation)
------------------------------------------------------------

-- Contact for Link B with same email as Link A contact
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0004',
        '00000000-0000-0000-0000-00000000001b',
        'existing1@example.com',
        'Same Email Different Link',
        NOW(),
        NOW());

------------------------------------------------------------
-- End of fixture
------------------------------------------------------------