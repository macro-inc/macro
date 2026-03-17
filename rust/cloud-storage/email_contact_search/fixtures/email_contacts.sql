-- Test macro_users
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('b1111111-1111-1111-1111-111111111111', 'user1', 'user1@test.com', 'stripe_id_1'),
    ('b2222222-2222-2222-2222-222222222222', 'user2', 'user2@test.com', 'stripe_id_2');

-- Test users
INSERT INTO "User" (id, email, name, macro_user_id)
VALUES
    ('macro|user1@test.com', 'user1@test.com', 'Test User 1', 'b1111111-1111-1111-1111-111111111111'),
    ('macro|user2@test.com', 'user2@test.com', 'Test User 2', 'b2222222-2222-2222-2222-222222222222');

-- Email links (email account connections for each user)
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('00000000-0000-0001-0000-000000000001', 'macro|user1@test.com', 'fa_user1', 'user1@test.com', 'GMAIL', true, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('00000000-0000-0002-0000-000000000002', 'macro|user2@test.com', 'fa_user2', 'user2@test.com', 'GMAIL', true, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- Email contacts with various names for testing
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    -- Contacts for user1's link
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0001-0000-000000000001', 'alice@example.com', 'Alice Smith', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0001-0000-000000000001', 'bob.johnson@example.com', 'Bob Johnson', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0001-0000-000000000001', 'charlie@example.com', 'Charlie Brown', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0001-0000-000000000001', 'david@example.com', 'David Miller', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
    -- Contact with NULL name (should use message-level override)
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0001-0000-000000000001', 'emily@example.com', NULL, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),

    -- Contacts for user2's link (for isolation testing)
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0002-0000-000000000002', 'frank@example.com', 'Frank Wilson', '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- Email threads for user1
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    -- Thread 1: Most recent (latest_non_spam_message_ts: 2024-12-06)
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-06 10:00:00+00', '2024-01-01 10:00:00+00', '2024-12-06 10:00:00+00'),

    -- Thread 2: Second most recent (latest_non_spam_message_ts: 2024-12-05)
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-05 10:00:00+00', '2024-02-01 10:00:00+00', '2024-12-05 10:00:00+00'),

    -- Thread 3: Third most recent (latest_non_spam_message_ts: 2024-12-04)
    ('33333333-3333-3333-3333-333333333333', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-04 10:00:00+00', '2024-03-01 10:00:00+00', '2024-12-04 10:00:00+00'),

    -- Thread 4: Fourth most recent (latest_non_spam_message_ts: 2024-12-03)
    ('44444444-4444-4444-4444-444444444444', '00000000-0000-0001-0000-000000000001', true, false, '2024-12-03 10:00:00+00', '2024-04-01 10:00:00+00', '2024-12-03 10:00:00+00'),

    -- Thread 5: Thread with NULL latest_non_spam_message_ts
    ('55555555-5555-5555-5555-555555555555', '00000000-0000-0001-0000-000000000001', true, false, NULL, '2024-05-01 10:00:00+00', '2024-05-01 10:00:00+00');

-- Email threads for user2 (for isolation testing)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, latest_non_spam_message_ts, created_at, updated_at)
VALUES
    ('99999999-9999-9999-9999-999999999999', '00000000-0000-0002-0000-000000000002', true, false, '2024-12-09 10:00:00+00', '2024-09-01 10:00:00+00', '2024-12-09 10:00:00+00');

-- Email messages for user1's threads
-- Thread 1: Alice is the sender
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, from_name, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0001-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'Subject 1', '2024-01-01 10:00:00+00', false, false, '2024-01-01 10:00:00+00', '2024-01-01 10:00:00+00');

-- Thread 2: Bob is the sender, Alice and Charlie are recipients
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, from_name, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0002-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '00000000-0000-0001-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'Subject 2', '2024-02-01 10:00:00+00', false, false, '2024-02-01 10:00:00+00', '2024-02-01 10:00:00+00');

-- Thread 3: Charlie is the sender with message-level name override
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, from_name, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0003-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '00000000-0000-0001-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Charles B. Brown', 'Subject 3', '2024-03-01 10:00:00+00', false, false, '2024-03-01 10:00:00+00', '2024-03-01 10:00:00+00');

-- Thread 4: Emily is the sender (has NULL name in contact, uses from_name override)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, from_name, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0004-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', '00000000-0000-0001-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Emily Davis', 'Subject 4', '2024-04-01 10:00:00+00', false, false, '2024-04-01 10:00:00+00', '2024-04-01 10:00:00+00');

-- Thread 5: David is sender
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, from_name, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0005-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', '00000000-0000-0001-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, 'Subject 5', '2024-05-01 10:00:00+00', false, false, '2024-05-01 10:00:00+00', '2024-05-01 10:00:00+00');

-- Email messages for user2's threads (for isolation testing)
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, from_name, subject, internal_date_ts, is_read, is_sent, created_at, updated_at)
VALUES
    ('10000000-0009-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', '00000000-0000-0002-0000-000000000002', 'ffffffff-ffff-ffff-ffff-ffffffffffff', NULL, 'User2 Subject', '2024-09-01 10:00:00+00', false, false, '2024-09-01 10:00:00+00', '2024-09-01 10:00:00+00');

-- Message recipients for Thread 1: Alice TO, Bob CC
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('10000000-0001-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TO', NULL),
    ('10000000-0001-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'CC', NULL);

-- Message recipients for Thread 2: Alice TO, Charlie CC, David BCC
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('10000000-0002-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TO', NULL),
    ('10000000-0002-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'CC', NULL),
    ('10000000-0002-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'BCC', NULL);

-- Message recipients for Thread 3: Bob TO with name override
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('10000000-0003-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TO', 'Robert J.');

-- Message recipients for Thread 4: David TO
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('10000000-0004-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'TO', NULL);

-- Message recipients for Thread 5: Emily TO
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('10000000-0005-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'TO', NULL);

-- Message recipients for user2's thread
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('10000000-0009-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'TO', NULL);
