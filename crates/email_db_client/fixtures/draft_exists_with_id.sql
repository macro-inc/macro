-- SQL fixture for draft_exists_with_id tests
-- Tests checking existence of draft messages by id and link_id

------------------------------------------------------------
-- User Links
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e01', 'macro|draft_exists_user@example.com', '00000000-0000-0000-0000-000000000e01',
        'draft_exists_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Second link for testing cross-link access prevention
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e02', 'macro|other_user@example.com', '00000000-0000-0000-0000-000000000e02',
        'other_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ce001',
        '00000000-0000-0000-0000-000000000e01',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Draft message (is_draft = true)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e501',
        '00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e501',
        FALSE,
        '00000000-0000-0000-0000-0000000ce001',
        '2025-01-05 10:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

------------------------------------------------------------
-- Message 2: Non-draft message (is_draft = false)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e502',
        '00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e502',
        TRUE,
        '00000000-0000-0000-0000-0000000ce001',
        '2025-01-05 11:00:00 +00:00',
        false, true, false, false, NOW(), NOW());