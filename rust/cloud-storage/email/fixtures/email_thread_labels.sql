-- Fixture for testing thread label repo methods:
-- get_label_by_id, get_thread_label_messages,
-- insert/delete_message_labels_batch,
-- update_message_read/starred_status_batch

-- Insert test links
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro1', 'user1', 'user1@test.com', 'GMAIL', true, NOW(), NOW()),
    ('aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 'macro2', 'user2', 'user2@test.com', 'GMAIL', true, NOW(), NOW());

-- Insert test threads
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'thread1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('22222222-2222-2222-2222-222222222222', 'thread2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW());

-- Insert test labels
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'UNREAD', 'UNREAD', 'Hide', 'LabelHide', 'System', NOW()),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'STARRED', 'STARRED', 'Show', 'LabelShowIfUnread', 'System', NOW()),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Label_123', 'MyCustomLabel', 'Show', 'LabelShow', 'User', NOW()),
    -- Label belonging to a different link
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW());

-- Insert test messages for thread 1 (2 messages, both unread, not starred)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg1a', false, false, false, false, false, '2025-01-01T10:00:00Z', NOW(), NOW()),
    ('11111111-bbbb-bbbb-bbbb-111111111111', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg1b', false, false, false, false, false, '2025-01-01T11:00:00Z', NOW(), NOW());

-- Insert test messages for thread 2 (empty thread scenario - no messages)

-- Message labels: msg1a has INBOX, msg1b has INBOX
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ('11111111-bbbb-bbbb-bbbb-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
