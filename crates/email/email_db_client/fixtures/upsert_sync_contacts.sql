-- SQL fixture for upsert_contacts (sync) name change detection tests

------------------------------------------------------------
-- Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000801', 'macro|sync_user@example.com', '00000000-0000-0000-0000-000000000801',
        'sync_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Pre-existing contacts
------------------------------------------------------------

-- Contact with a name (will test name change)
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c8001',
        '00000000-0000-0000-0000-000000000801',
        'alice@example.com',
        'Old Alice',
        NOW(), NOW());

-- Contact with no name (will test null -> name)
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c8002',
        '00000000-0000-0000-0000-000000000801',
        'bob@example.com',
        NULL,
        NOW(), NOW());

-- Contact whose name won't change
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c8003',
        '00000000-0000-0000-0000-000000000801',
        'charlie@example.com',
        'Charlie',
        NOW(), NOW());
