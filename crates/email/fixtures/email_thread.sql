-- Fixture for testing thread_by_id and messages_by_thread_id_paginated queries

-- Insert test link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user1@test.com', 'fa-user-1', 'user1@test.com', 'GMAIL', true, NOW(), NOW());

-- Insert test threads
-- Thread 1: inbox_visible, unread, with timestamps
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'provider-thread-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false,
     '2025-01-15 10:00:00+00', '2025-01-14 09:00:00+00', '2025-01-15 10:00:00+00', '2025-01-01 00:00:00+00', '2025-01-15 10:00:00+00');

-- Thread 2: read, not inbox_visible, no outbound
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    ('22222222-2222-2222-2222-222222222222', 'provider-thread-2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, true,
     '2025-02-01 12:00:00+00', '2025-02-01 12:00:00+00', '2025-01-10 00:00:00+00', '2025-02-01 12:00:00+00');

-- Thread 3: empty thread (no messages) for edge case testing
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('33333333-3333-3333-3333-333333333333', 'provider-thread-3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW());

-- Insert messages for Thread 1 (3 messages with different timestamps for pagination testing)
INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, snippet, subject, is_read, is_sent, is_draft, has_attachments, created_at, updated_at)
VALUES
    ('11111111-aaaa-0001-aaaa-111111111111', 'msg-1-oldest', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2025-01-13 08:00:00+00', 'First message snippet', 'Hello', false, false, false, false, '2025-01-13 08:00:00+00', '2025-01-13 08:00:00+00'),
    ('11111111-aaaa-0002-aaaa-111111111111', 'msg-1-middle', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2025-01-14 09:00:00+00', 'Reply snippet', 'Re: Hello', true, true, false, false, '2025-01-14 09:00:00+00', '2025-01-14 09:00:00+00'),
    ('11111111-aaaa-0003-aaaa-111111111111', 'msg-1-newest', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2025-01-15 10:00:00+00', 'Latest reply', 'Re: Re: Hello', false, false, false, true, '2025-01-15 10:00:00+00', '2025-01-15 10:00:00+00');

-- Insert messages for Thread 2 (1 message)
INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, snippet, subject, is_read, is_sent, is_draft, has_attachments, created_at, updated_at)
VALUES
    ('22222222-aaaa-0001-aaaa-222222222222', 'msg-2-only', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2025-02-01 12:00:00+00', 'Thread 2 message', 'Different thread', true, false, false, false, '2025-02-01 12:00:00+00', '2025-02-01 12:00:00+00');
