-- Fixture for link_has_any_message_with: one link with a received message
-- (sender + a cc'd co-recipient), a sent message, and a contact with no
-- messages; a second link has its own received message.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000701', 'macro|scan_user@example.com', '00000000-0000-0000-0000-000000000701',
        'scan_user@example.com', 'GMAIL', true, NOW(), NOW()),
       ('00000000-0000-0000-0000-000000000702', 'macro|scan_user@example.com', '00000000-0000-0000-0000-000000000702',
        'scan_user_two@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c7001', '00000000-0000-0000-0000-000000000701', 'sender@example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-000000000701', 'cc@example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000c7003', '00000000-0000-0000-0000-000000000701', 'Sent.To@Example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000c7004', '00000000-0000-0000-0000-000000000701', 'quiet@example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000c7005', '00000000-0000-0000-0000-000000000701', 'other-link@example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000c7006', '00000000-0000-0000-0000-000000000702', 'other-link@example.com', NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000007201', '00000000-0000-0000-0000-000000000701', true, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-000000007202', '00000000-0000-0000-0000-000000000702', true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES
    -- Received on link 1: from sender@, cc'd to cc@.
    ('00000000-0000-0000-0000-000000007501', '00000000-0000-0000-0000-000000007201',
     '00000000-0000-0000-0000-000000000701', 'provider-msg-7501', FALSE,
     '00000000-0000-0000-0000-0000000c7001', '2025-01-05 10:00:00 +00:00', false, false, false, false, NOW(), NOW()),
    -- Sent on link 1: to Sent.To@.
    ('00000000-0000-0000-0000-000000007502', '00000000-0000-0000-0000-000000007201',
     '00000000-0000-0000-0000-000000000701', 'provider-msg-7502', TRUE,
     NULL, '2025-01-05 11:00:00 +00:00', false, false, false, false, NOW(), NOW()),
    -- Received on link 2: from that link's other-link@.
    ('00000000-0000-0000-0000-000000007503', '00000000-0000-0000-0000-000000007202',
     '00000000-0000-0000-0000-000000000702', 'provider-msg-7503', FALSE,
     '00000000-0000-0000-0000-0000000c7006', '2025-01-05 12:00:00 +00:00', false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-000000007501', '00000000-0000-0000-0000-0000000c7002', 'CC'),
       ('00000000-0000-0000-0000-000000007502', '00000000-0000-0000-0000-0000000c7003', 'TO');
