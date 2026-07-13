-- SQL fixture for scheduled_messages tests
-- Tests get_and_start_processing_scheduled_message operation

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e01', 'macro|scheduled_user@example.com', '00000000-0000-0000-0000-000000000e01',
        'scheduled_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Second link for testing cross-link access prevention
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e02', 'macro|other_scheduled_user@example.com', '00000000-0000-0000-0000-000000000e02',
        'other_scheduled_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ce001',
        '00000000-0000-0000-0000-000000000e01',
        'scheduled_sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Scheduled message not yet processing (processing = false, sent = false)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e501',
        '00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        'provider-scheduled-501',
        FALSE,
        '00000000-0000-0000-0000-0000000ce001',
        '2025-01-10 10:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e01',
        '00000000-0000-0000-0000-00000000e501',
        '2025-01-15 10:00:00 +00:00',
        false,
        false,
        NOW(), NOW());

------------------------------------------------------------
-- Message 2: Scheduled message already processing (processing = true, sent = false)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e502',
        '00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        'provider-scheduled-502',
        FALSE,
        '00000000-0000-0000-0000-0000000ce001',
        '2025-01-10 11:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e01',
        '00000000-0000-0000-0000-00000000e502',
        '2025-01-15 11:00:00 +00:00',
        false,
        true,
        NOW(), NOW());

------------------------------------------------------------
-- Message 3: Scheduled message already sent (processing = false, sent = true)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e503',
        '00000000-0000-0000-0000-00000000e201',
        '00000000-0000-0000-0000-000000000e01',
        'provider-scheduled-503',
        TRUE,
        '00000000-0000-0000-0000-0000000ce001',
        '2025-01-10 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e01',
        '00000000-0000-0000-0000-00000000e503',
        '2025-01-15 12:00:00 +00:00',
        true,
        false,
        NOW(), NOW());