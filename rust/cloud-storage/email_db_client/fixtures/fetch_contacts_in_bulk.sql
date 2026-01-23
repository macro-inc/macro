-- SQL fixture for fetch_senders_by_message_ids and fetch_db_recipients_in_bulk tests
-- Tests fetching sender contacts and recipients for multiple message IDs in a single query

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000601', 'macro|bulk_contacts_user@example.com', '00000000-0000-0000-0000-000000000601',
        'bulk_contacts_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts (senders and recipients)
------------------------------------------------------------

-- Sender 1: Alice
INSERT INTO email_contacts (id, link_id, email_address, name, original_photo_url, sfs_photo_url, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c6001',
        '00000000-0000-0000-0000-000000000601',
        'alice@example.com',
        'Alice Sender',
        'https://photos.example.com/alice.jpg',
        'https://sfs.example.com/alice.jpg',
        NOW(), NOW());

-- Sender 2: Bob
INSERT INTO email_contacts (id, link_id, email_address, name, original_photo_url, sfs_photo_url, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c6002',
        '00000000-0000-0000-0000-000000000601',
        'bob@example.com',
        'Bob Sender',
        NULL,
        NULL,
        NOW(), NOW());

-- Recipient 1: Charlie
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c6003',
        '00000000-0000-0000-0000-000000000601',
        'charlie@example.com',
        'Charlie Recipient',
        NOW(), NOW());

-- Recipient 2: Diana
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c6004',
        '00000000-0000-0000-0000-000000000601',
        'diana@example.com',
        'Diana Recipient',
        NOW(), NOW());

-- Recipient 3: Eve
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c6005',
        '00000000-0000-0000-0000-000000000601',
        'eve@example.com',
        'Eve Recipient',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000006201',
        '00000000-0000-0000-0000-000000000601',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: From Alice, to Charlie (TO), Diana (CC)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, from_name, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000006501',
        '00000000-0000-0000-0000-000000006201',
        '00000000-0000-0000-0000-000000000601',
        'provider-msg-6501',
        FALSE,
        '00000000-0000-0000-0000-0000000c6001',
        'Alice Custom Name',
        '2025-01-05 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000006501', '00000000-0000-0000-0000-0000000c6003', 'TO');

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000006501', '00000000-0000-0000-0000-0000000c6004', 'CC');

------------------------------------------------------------
-- Message 2: From Bob, to Eve (TO), Charlie (CC), Diana (BCC)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000006502',
        '00000000-0000-0000-0000-000000006201',
        '00000000-0000-0000-0000-000000000601',
        'provider-msg-6502',
        FALSE,
        '00000000-0000-0000-0000-0000000c6002',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000006502', '00000000-0000-0000-0000-0000000c6005', 'TO');

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000006502', '00000000-0000-0000-0000-0000000c6003', 'CC');

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000006502', '00000000-0000-0000-0000-0000000c6004', 'BCC');

------------------------------------------------------------
-- Message 3: No from_contact_id (system generated)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000006503',
        '00000000-0000-0000-0000-000000006201',
        '00000000-0000-0000-0000-000000000601',
        'provider-msg-6503',
        FALSE,
        NULL,
        '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

------------------------------------------------------------
-- Message 4: No recipients
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000006504',
        '00000000-0000-0000-0000-000000006201',
        '00000000-0000-0000-0000-000000000601',
        'provider-msg-6504',
        FALSE,
        '00000000-0000-0000-0000-0000000c6001',
        '2025-01-05 13:00:00 +00:00',
        false, false, false, false, NOW(), NOW());
