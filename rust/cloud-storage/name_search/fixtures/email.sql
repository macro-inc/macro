-- Test users
INSERT INTO "User" (id, email, name)
VALUES
    ('macro|user1@test.com', 'user1@test.com', 'Test User 1'),
    ('macro|user2@test.com', 'user2@test.com', 'Test User 2'),
    ('macro|user3@test.com', 'user3@test.com', 'Test User 3');

-- Email links (email account connections for each user)
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('00000000-0000-0001-0000-000000000001', 'macro|user1@test.com', 'fa_user1', 'user1@test.com', 'GMAIL', true, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('00000000-0000-0002-0000-000000000002', 'macro|user2@test.com', 'fa_user2', 'user2@test.com', 'GMAIL', true, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('00000000-0000-0003-0000-000000000003', 'macro|user3@test.com', 'fa_user3', 'user3@test.com', 'GMAIL', true, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- Email contacts (senders/recipients)
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    -- Contacts for user1's link
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0001-0000-000000000001', 'sender1@example.com', 'Sender One', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0001-0000-000000000001', 'sender2@example.com', 'Sender Two', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),

    -- Contacts for user2's link
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0002-0000-000000000002', 'sender3@example.com', 'Sender Three', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),

    -- Contacts for user3's link
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0003-0000-000000000003', 'sender4@example.com', 'Sender Four', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- Email threads for user1
-- Threads matching "invoice" (3 threads)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    -- Thread 1: Invoice from Q1 2024 (oldest invoice, latest_non_spam_message_ts: 2024-12-01)
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-01 10:00:00+00', '2024-01-01 10:00:00+00', '2024-12-01 10:00:00+00'),

    -- Thread 2: Monthly Invoice - December (multiple messages, latest_non_spam_message_ts: 2024-12-02)
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-02 10:00:00+00', '2024-02-01 10:00:00+00', '2024-12-02 10:00:00+00'),

    -- Thread 3: IMPORTANT: INVOICE DUE (uppercase, latest_non_spam_message_ts: 2024-12-06)
    ('66666666-6666-6666-6666-666666666666', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-06 10:00:00+00', '2024-06-01 10:00:00+00', '2024-12-06 10:00:00+00');

-- Threads matching "meet" (2 threads)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    -- Thread 4: Team Meeting Notes (latest_non_spam_message_ts: 2024-12-03)
    ('33333333-3333-3333-3333-333333333333', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-03 10:00:00+00', '2024-03-01 10:00:00+00', '2024-12-03 10:00:00+00'),

    -- Thread 5: Fwd: Client Meeting Tomorrow (latest_non_spam_message_ts: 2024-12-04)
    ('44444444-4444-4444-4444-444444444444', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-04 10:00:00+00', '2024-04-01 10:00:00+00', '2024-12-04 10:00:00+00');

-- Other threads for user1 (for various test scenarios)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    -- Thread 6: Weekly Update (no match, latest_non_spam_message_ts: 2024-12-05)
    ('55555555-5555-5555-5555-555555555555', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-05 10:00:00+00', '2024-05-01 10:00:00+00', '2024-12-05 10:00:00+00'),

    -- Thread 7: Project Status (no match, latest_non_spam_message_ts: 2024-12-07)
    ('77777777-7777-7777-7777-777777777777', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-07 10:00:00+00', '2024-07-01 10:00:00+00', '2024-12-07 10:00:00+00');

-- Email threads for user2 (for isolation testing)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    ('88888888-8888-8888-8888-888888888888', '00000000-0000-0002-0000-000000000002', true, false, '2024-12-08 10:00:00+00', '2024-08-01 10:00:00+00', '2024-12-08 10:00:00+00');

-- Email threads for user3 (for shared thread testing)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    ('99999999-9999-9999-9999-999999999999', '00000000-0000-0003-0000-000000000003', true, false, '2024-12-09 10:00:00+00', '2024-09-01 10:00:00+00', '2024-12-09 10:00:00+00');

-- Email messages for user1's threads
-- Thread 11111111: Invoice from Q1 2024 (multiple messages, oldest has the search subject)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    -- Oldest message (this is what gets searched)
    ('10000000-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Invoice from Q1 2024', '2024-01-01 10:00:00+00', false, false, '2024-01-01 10:00:00+00', '2024-01-01 10:00:00+00'),

    -- Newer reply (should not be used for search)
    ('10000000-0001-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '00000000-0000-0001-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Re: Invoice from Q1 2024', '2024-12-01 10:00:00+00', false, true, '2024-12-01 10:00:00+00', '2024-12-01 10:00:00+00');

-- Thread 22222222: Monthly Invoice - December (3 messages to test oldest message logic)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    -- Oldest message with "Monthly Invoice" (this is what gets searched)
    ('10000000-0002-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Re: Monthly Invoice - December', '2024-02-01 10:00:00+00', false, false, '2024-02-01 10:00:00+00', '2024-02-01 10:00:00+00'),

    -- Middle message (should not be used for search)
    ('10000000-0002-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '00000000-0000-0001-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Re: Re: Monthly Invoice - December', '2024-02-02 10:00:00+00', false, true, '2024-02-02 10:00:00+00', '2024-02-02 10:00:00+00'),

    -- Newest message with different subject (should not be used for search)
    ('10000000-0002-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Re: Re: Re: Payment Processed', '2024-12-02 10:00:00+00', false, false, '2024-12-02 10:00:00+00', '2024-12-02 10:00:00+00');

-- Thread 33333333: Team Meeting Notes
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0003-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Team Meeting Notes', '2024-03-01 10:00:00+00', false, false, '2024-03-01 10:00:00+00', '2024-03-01 10:00:00+00');

-- Thread 44444444: Fwd: Client Meeting Tomorrow
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0004-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', '00000000-0000-0001-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Fwd: Client Meeting Tomorrow', '2024-04-01 10:00:00+00', false, false, '2024-04-01 10:00:00+00', '2024-04-01 10:00:00+00');

-- Thread 55555555: Weekly Update
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0005-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Weekly Update - January 2024', '2024-05-01 10:00:00+00', false, false, '2024-05-01 10:00:00+00', '2024-05-01 10:00:00+00');

-- Thread 66666666: IMPORTANT: INVOICE DUE (uppercase invoice)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0006-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'IMPORTANT: INVOICE DUE', '2024-06-01 10:00:00+00', false, false, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

-- Thread 77777777: Project Status
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0007-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', '00000000-0000-0001-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Project Status Report', '2024-07-01 10:00:00+00', false, false, '2024-07-01 10:00:00+00', '2024-07-01 10:00:00+00');

-- Email messages for user2's threads (for isolation testing)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0008-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888', '00000000-0000-0002-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'User2 Private Email', '2024-08-01 10:00:00+00', false, false, '2024-08-01 10:00:00+00', '2024-08-01 10:00:00+00');

-- Email messages for user3's threads (for shared thread testing)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0009-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', '00000000-0000-0003-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'User3 Invoice Shared', '2024-09-01 10:00:00+00', false, false, '2024-09-01 10:00:00+00', '2024-09-01 10:00:00+00');
