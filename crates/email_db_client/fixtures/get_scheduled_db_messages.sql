-- SQL fixture for get_scheduled_db_messages_by_link_id tests
-- Tests fetching unsent scheduled messages with pagination

------------------------------------------------------------
-- Link 1: Primary test link with multiple scheduled messages
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'macro|scheduled_user@example.com', '00000000-0000-0000-0000-0000000a0001',
        'scheduled_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Contact for link 1
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-000000000001',
        'scheduled_user@example.com', NOW(), NOW());

-- Thread for link 1
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-000000000001',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Unsent scheduled message (oldest)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000d0001',
        '00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-000000000001',
        'provider-msg-001',
        FALSE,
        '00000000-0000-0000-0000-0000000c0001',
        '2025-01-01 10:00:00 +00:00',
        false, false, false, true,
        'Oldest scheduled message',
        NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days');

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d0001',
        NOW() + INTERVAL '1 day', false, NOW(), NOW());

------------------------------------------------------------
-- Message 2: Unsent scheduled message (middle)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000d0002',
        '00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-000000000001',
        'provider-msg-002',
        FALSE,
        '00000000-0000-0000-0000-0000000c0001',
        '2025-01-02 10:00:00 +00:00',
        false, false, false, true,
        'Middle scheduled message',
        NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days');

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d0002',
        NOW() + INTERVAL '2 days', false, NOW(), NOW());

------------------------------------------------------------
-- Message 3: Unsent scheduled message (newest)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000d0003',
        '00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-000000000001',
        'provider-msg-003',
        FALSE,
        '00000000-0000-0000-0000-0000000c0001',
        '2025-01-03 10:00:00 +00:00',
        false, false, false, true,
        'Newest scheduled message',
        NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d0003',
        NOW() + INTERVAL '3 days', false, NOW(), NOW());

------------------------------------------------------------
-- Message 4: ALREADY SENT scheduled message (should be excluded)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000d0004',
        '00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-000000000001',
        'provider-msg-004',
        TRUE,
        '00000000-0000-0000-0000-0000000c0001',
        '2025-01-04 10:00:00 +00:00',
        false, true, false, false,
        'Already sent message',
        NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days');

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d0004',
        NOW() - INTERVAL '4 days', true, NOW(), NOW());

------------------------------------------------------------
-- Message 5: Regular message (NOT scheduled, should be excluded)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000d0005',
        '00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-000000000001',
        'provider-msg-005',
        TRUE,
        '00000000-0000-0000-0000-0000000c0001',
        '2025-01-05 10:00:00 +00:00',
        false, true, false, false,
        'Regular non-scheduled message',
        NOW(), NOW());

------------------------------------------------------------
-- Link 2: Different user (for isolation test)
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', 'macro|other_user@example.com', '00000000-0000-0000-0000-0000000a0002',
        'other_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Contact for link 2
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-000000000002',
        'other_user@example.com', NOW(), NOW());

-- Thread for link 2
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-000000000002',
        true, false, NOW(), NOW());

-- Scheduled message for link 2 (should NOT appear in link 1 queries)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000d0006',
        '00000000-0000-0000-0000-0000000b0002',
        '00000000-0000-0000-0000-000000000002',
        'provider-msg-006',
        FALSE,
        '00000000-0000-0000-0000-0000000c0002',
        '2025-01-06 10:00:00 +00:00',
        false, false, false, true,
        'Other user scheduled message',
        NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000d0006',
        NOW() + INTERVAL '1 day', false, NOW(), NOW());