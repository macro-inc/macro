-- Fixture for testing draft-related repo methods:
-- get_simple_message, get_draft_replying_to, upsert_contacts, insert_draft_message

-- Insert test link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user1@test.com', 'fa-user-1', 'user1@test.com', 'GMAIL', true, NOW(), NOW());

-- Insert contacts
INSERT INTO email_contacts (id, link_id, email_address, name, sfs_photo_url, created_at, updated_at)
VALUES
    ('c0000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@example.com', 'Alice Smith', NULL, NOW(), NOW()),
    ('c0000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bob@example.com', 'Bob Jones', NULL, NOW(), NOW()),
    ('c0000003-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'carol@example.com', NULL, NULL, NOW(), NOW());

-- Insert labels (needed for thread metadata update)
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('bb000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('bb000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SENT', 'SENT', 'Show', 'LabelShow', 'System', NOW());

-- Insert threads
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'provider-thread-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('22222222-2222-2222-2222-222222222222', 'provider-thread-2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, true, NOW(), NOW());

-- msg1: A regular sent message in thread 1 (for get_simple_message and replying_to tests)
INSERT INTO email_messages (id, provider_id, thread_id, provider_thread_id, link_id, from_contact_id, subject, is_read, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES
    ('ee000001-0000-0000-0000-000000000001', 'provider-msg-1', '11111111-1111-1111-1111-111111111111', 'provider-thread-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000001-0000-0000-0000-000000000001', 'Hello World', true, true, false, false, '2025-01-10 10:00:00+00', '2025-01-10 10:00:00+00', '2025-01-10 10:00:00+00');

-- msg1 has INBOX + SENT labels
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('ee000001-0000-0000-0000-000000000001', 'bb000001-0000-0000-0000-000000000001'),
    ('ee000001-0000-0000-0000-000000000001', 'bb000002-0000-0000-0000-000000000002');

-- msg1 has recipients: bob=TO
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('ee000001-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000002', 'TO', NULL);

-- msg2: A draft in thread 1 replying to msg1, identified by Macro-In-Reply-To header
INSERT INTO email_messages (id, thread_id, provider_thread_id, link_id, from_contact_id, replying_to_id, subject, is_read, is_sent, is_draft, has_attachments, headers_jsonb, created_at, updated_at)
VALUES
    ('ee000002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'provider-thread-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000001-0000-0000-0000-000000000001', 'ee000001-0000-0000-0000-000000000001', 'Re: Hello World', true, false, true, false,
     '[{"Macro-In-Reply-To": "ee000001-0000-0000-0000-000000000001"}]',
     '2025-01-11 10:00:00+00', '2025-01-11 10:00:00+00');

-- msg3: A regular message in thread 2 (for testing draft insert into existing thread)
INSERT INTO email_messages (id, provider_id, thread_id, provider_thread_id, link_id, from_contact_id, subject, is_read, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES
    ('ee000003-0000-0000-0000-000000000003', 'provider-msg-3', '22222222-2222-2222-2222-222222222222', 'provider-thread-2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000002-0000-0000-0000-000000000002', 'Different thread', true, false, false, false, '2025-02-01 12:00:00+00', '2025-02-01 12:00:00+00', '2025-02-01 12:00:00+00');

-- msg3 has INBOX label
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('ee000003-0000-0000-0000-000000000003', 'bb000001-0000-0000-0000-000000000001');
