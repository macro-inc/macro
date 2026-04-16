-- SQL fixture for get_thread_ids_by_contact_ids tests

------------------------------------------------------------
-- Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000901', 'macro|thread_contact_user@example.com', '00000000-0000-0000-0000-000000000901',
        'thread_contact_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

-- Contact A: will be a sender
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c9001',
        '00000000-0000-0000-0000-000000000901',
        'sender@example.com',
        'Sender',
        NOW(), NOW());

-- Contact B: will be a recipient only
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c9002',
        '00000000-0000-0000-0000-000000000901',
        'recipient@example.com',
        'Recipient',
        NOW(), NOW());

-- Contact C: appears in both roles across threads
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c9003',
        '00000000-0000-0000-0000-000000000901',
        'both@example.com',
        'Both Roles',
        NOW(), NOW());

-- Contact D: orphan, not in any messages
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c9004',
        '00000000-0000-0000-0000-000000000901',
        'orphan@example.com',
        'Orphan',
        NOW(), NOW());

------------------------------------------------------------
-- Threads
------------------------------------------------------------

-- Thread 1
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000009201',
        '00000000-0000-0000-0000-000000000901',
        true, false, NOW(), NOW());

-- Thread 2
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000009202',
        '00000000-0000-0000-0000-000000000901',
        true, false, NOW(), NOW());

-- Thread 3
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000009203',
        '00000000-0000-0000-0000-000000000901',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Messages
------------------------------------------------------------

-- Message 1: in Thread 1, Contact A is sender
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000009501',
        '00000000-0000-0000-0000-000000009201',
        '00000000-0000-0000-0000-000000000901',
        'provider-msg-9501',
        FALSE,
        '00000000-0000-0000-0000-0000000c9001',
        '2025-01-05 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

-- Message 1 recipients: Contact B is TO
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000009501', '00000000-0000-0000-0000-0000000c9002', 'TO');

-- Message 2: in Thread 2, Contact C is sender
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000009502',
        '00000000-0000-0000-0000-000000009202',
        '00000000-0000-0000-0000-000000000901',
        'provider-msg-9502',
        FALSE,
        '00000000-0000-0000-0000-0000000c9003',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

-- Message 3: in Thread 3, Contact A is sender, Contact C is recipient
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000009503',
        '00000000-0000-0000-0000-000000009203',
        '00000000-0000-0000-0000-000000000901',
        'provider-msg-9503',
        FALSE,
        '00000000-0000-0000-0000-0000000c9001',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000009503', '00000000-0000-0000-0000-0000000c9003', 'TO');
