-- SQL fixture for fetch_scheduled_messages_in_bulk tests
-- Tests fetching scheduled messages for multiple message IDs in a single query

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000701', 'macro|bulk_scheduled_user@example.com', '00000000-0000-0000-0000-000000000701',
        'bulk_scheduled_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c7001',
        '00000000-0000-0000-0000-000000000701',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000007201',
        '00000000-0000-0000-0000-000000000701',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Scheduled, not sent, not processing
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000007501',
        '00000000-0000-0000-0000-000000007201',
        '00000000-0000-0000-0000-000000000701',
        NULL,
        FALSE,
        '00000000-0000-0000-0000-0000000c7001',
        '2025-01-05 10:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000701',
        '00000000-0000-0000-0000-000000007501',
        '2025-01-15 10:00:00 +00:00',
        false,
        false,
        NOW(), NOW());

------------------------------------------------------------
-- Message 2: Scheduled, not sent, currently processing
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000007502',
        '00000000-0000-0000-0000-000000007201',
        '00000000-0000-0000-0000-000000000701',
        NULL,
        FALSE,
        '00000000-0000-0000-0000-0000000c7001',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000701',
        '00000000-0000-0000-0000-000000007502',
        '2025-01-15 11:00:00 +00:00',
        false,
        true,
        NOW(), NOW());

------------------------------------------------------------
-- Message 3: Scheduled but already sent (should be excluded)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000007503',
        '00000000-0000-0000-0000-000000007201',
        '00000000-0000-0000-0000-000000000701',
        'provider-msg-7503',
        TRUE,
        '00000000-0000-0000-0000-0000000c7001',
        '2025-01-05 12:00:00 +00:00',
        false, true, false, false, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, processing, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000701',
        '00000000-0000-0000-0000-000000007503',
        '2025-01-10 12:00:00 +00:00',
        true,
        false,
        NOW(), NOW());

------------------------------------------------------------
-- Message 4: Not scheduled
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000007504',
        '00000000-0000-0000-0000-000000007201',
        '00000000-0000-0000-0000-000000000701',
        'provider-msg-7504',
        FALSE,
        '00000000-0000-0000-0000-0000000c7001',
        '2025-01-05 13:00:00 +00:00',
        false, false, false, false, NOW(), NOW());
