-- Fixture for testing labels_by_thread_ids query
-- Sets up threads, messages, labels, and their relationships

-- Insert test link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro1', 'user1', 'user1@test.com', 'GMAIL', true, NOW(), NOW());

-- Insert test threads
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'thread1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('22222222-2222-2222-2222-222222222222', 'thread2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('33333333-3333-3333-3333-333333333333', 'thread3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('44444444-4444-4444-4444-444444444444', 'thread4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('55555555-5555-5555-5555-555555555555', 'thread5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW());

-- Insert test labels
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'IMPORTANT', 'IMPORTANT', 'Show', 'LabelShow', 'System', NOW()),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SENT', 'SENT', 'Show', 'LabelShow', 'System', NOW()),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Label_123', 'MyCustomLabel', 'Show', 'LabelShow', 'User', NOW());

-- Insert test messages
-- Thread 1: 1 message with INBOX and IMPORTANT labels
INSERT INTO email_messages (id, thread_id, link_id, provider_id, created_at, updated_at)
VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg1', NOW(), NOW());

-- Thread 2: 1 message with INBOX and SENT labels
INSERT INTO email_messages (id, thread_id, link_id, provider_id, created_at, updated_at)
VALUES
    ('22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg2', NOW(), NOW());

-- Thread 3: 2 messages both with INBOX label (test deduplication)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, created_at, updated_at)
VALUES
    ('33333333-aaaa-aaaa-aaaa-333333333333', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg3a', NOW(), NOW()),
    ('33333333-bbbb-bbbb-bbbb-333333333333', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg3b', NOW(), NOW());

-- Thread 4: No messages (test empty case)

-- Thread 5: 1 message with both system and user labels
INSERT INTO email_messages (id, thread_id, link_id, provider_id, created_at, updated_at)
VALUES
    ('55555555-aaaa-aaaa-aaaa-555555555555', '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg5', NOW(), NOW());

-- Insert message-label relationships
-- Thread 1 message: INBOX + IMPORTANT
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ('11111111-aaaa-aaaa-aaaa-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- Thread 2 message: INBOX + SENT
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('22222222-aaaa-aaaa-aaaa-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ('22222222-aaaa-aaaa-aaaa-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- Thread 3 messages: Both have INBOX (test deduplication)
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('33333333-aaaa-aaaa-aaaa-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ('33333333-bbbb-bbbb-bbbb-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Thread 5 message: INBOX (system) + MyCustomLabel (user)
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('55555555-aaaa-aaaa-aaaa-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ('55555555-aaaa-aaaa-aaaa-555555555555', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');