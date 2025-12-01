-- Fixture for testing dynamic email query builder
-- Sets up threads, messages, contacts, recipients, labels for comprehensive testing

-- Insert test link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro1', 'user1', 'user1@test.com', 'GMAIL', true, NOW(), NOW());

-- Insert test contacts
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('40000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'john@example.com', 'John Doe', NOW(), NOW()),
    ('40000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'jane@example.com', 'Jane Smith', NOW(), NOW()),
    ('40000003-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bob@example.com', 'Bob Johnson', NOW(), NOW()),
    ('40000004-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@example.com', 'Alice Williams', NOW(), NOW());

-- Insert test labels
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('10000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('10000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'IMPORTANT', 'IMPORTANT', 'Show', 'LabelShow', 'System', NOW()),
    ('10000003-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SENT', 'SENT', 'Show', 'LabelShow', 'System', NOW()),
    ('10000004-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'STARRED', 'STARRED', 'Show', 'LabelShow', 'System', NOW()),
    ('10000005-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DRAFT', 'DRAFT', 'Show', 'LabelShow', 'System', NOW()),
    ('10000006-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW()),
    ('10000007-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Label_Work', 'Work', 'Show', 'LabelShow', 'User', NOW());

-- Insert test threads
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    -- Thread 1: Inbox, from john@example.com
    ('20000001-0000-0000-0000-000000000001', 'thread1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     true, false, '2024-01-15 10:00:00+00', NULL, '2024-01-15 10:00:00+00', NOW(), NOW()),

    -- Thread 2: Sent, to jane@example.com
    ('20000002-0000-0000-0000-000000000002', 'thread2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, true, NULL, '2024-01-14 09:00:00+00', '2024-01-14 09:00:00+00', NOW(), NOW()),

    -- Thread 3: Draft from bob@example.com
    ('20000003-0000-0000-0000-000000000003', 'thread3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-13 08:00:00+00', NOW(), NOW()),

    -- Thread 4: Starred, from alice@example.com
    ('20000004-0000-0000-0000-000000000004', 'thread4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     true, false, '2024-01-12 07:00:00+00', NULL, '2024-01-12 07:00:00+00', NOW(), NOW()),

    -- Thread 5: Important inbox from john@example.com
    ('20000005-0000-0000-0000-000000000005', 'thread5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     true, false, '2024-01-11 06:00:00+00', NULL, '2024-01-11 06:00:00+00', NOW(), NOW()),

    -- Thread 6: User label "Work", from jane@example.com
    ('20000006-0000-0000-0000-000000000006', 'thread6', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-10 05:00:00+00', NOW(), NOW()),

    -- Thread 7: Inbox with CC to bob@example.com
    ('20000007-0000-0000-0000-000000000007', 'thread7', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     true, false, '2024-01-09 04:00:00+00', NULL, '2024-01-09 04:00:00+00', NOW(), NOW());

-- Insert test messages
INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    -- Message 1: Inbox from john@example.com
    ('30000001-0000-0000-0000-000000000001', '20000001-0000-0000-0000-000000000001',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg1', '40000001-0000-0000-0000-000000000001',
     'Meeting Tomorrow', 'Lets meet tomorrow at 10am', '2024-01-15 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    -- Message 2: Sent to jane@example.com
    ('30000002-0000-0000-0000-000000000002', '20000002-0000-0000-0000-000000000002',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg2', '40000001-0000-0000-0000-000000000001',
     'Project Update', 'Here is the update', '2024-01-14 09:00:00+00',
     false, true, false, true, NOW(), NOW()),

    -- Message 3: Draft from bob@example.com
    ('30000003-0000-0000-0000-000000000003', '20000003-0000-0000-0000-000000000003',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg3', '40000003-0000-0000-0000-000000000003',
     'Draft Email', 'This is a draft', '2024-01-13 08:00:00+00',
     true, false, false, false, NOW(), NOW()),

    -- Message 4: Starred from alice@example.com
    ('30000004-0000-0000-0000-000000000004', '20000004-0000-0000-0000-000000000004',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg4', '40000004-0000-0000-0000-000000000004',
     'Important Info', 'Please review', '2024-01-12 07:00:00+00',
     false, false, true, false, NOW(), NOW()),

    -- Message 5: Important inbox from john@example.com
    ('30000005-0000-0000-0000-000000000005', '20000005-0000-0000-0000-000000000005',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg5', '40000001-0000-0000-0000-000000000001',
     'Urgent: Action Required', 'Please respond ASAP', '2024-01-11 06:00:00+00',
     false, false, false, false, NOW(), NOW()),

    -- Message 6: User label "Work" from jane@example.com
    ('30000006-0000-0000-0000-000000000006', '20000006-0000-0000-0000-000000000006',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg6', '40000002-0000-0000-0000-000000000002',
     'Work Project', 'Quarterly review', '2024-01-10 05:00:00+00',
     false, false, false, false, NOW(), NOW()),

    -- Message 7: Inbox with CC to bob@example.com
    ('30000007-0000-0000-0000-000000000007', '20000007-0000-0000-0000-000000000007',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg7', '40000002-0000-0000-0000-000000000002',
     'Team Update', 'FYI for everyone', '2024-01-09 04:00:00+00',
     false, false, false, false, NOW(), NOW());

-- Insert message recipients
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    -- Message 1: To alice@example.com
    ('30000001-0000-0000-0000-000000000001', '40000004-0000-0000-0000-000000000004', 'TO'),

    -- Message 2: To jane@example.com
    ('30000002-0000-0000-0000-000000000002', '40000002-0000-0000-0000-000000000002', 'TO'),

    -- Message 3: To alice@example.com
    ('30000003-0000-0000-0000-000000000003', '40000004-0000-0000-0000-000000000004', 'TO'),

    -- Message 4: To john@example.com
    ('30000004-0000-0000-0000-000000000004', '40000001-0000-0000-0000-000000000001', 'TO'),

    -- Message 5: To alice@example.com
    ('30000005-0000-0000-0000-000000000005', '40000004-0000-0000-0000-000000000004', 'TO'),

    -- Message 6: To john@example.com
    ('30000006-0000-0000-0000-000000000006', '40000001-0000-0000-0000-000000000001', 'TO'),

    -- Message 7: To alice@example.com, CC bob@example.com
    ('30000007-0000-0000-0000-000000000007', '40000004-0000-0000-0000-000000000004', 'TO'),
    ('30000007-0000-0000-0000-000000000007', '40000003-0000-0000-0000-000000000003', 'CC');

-- Insert message-label relationships
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    -- Message 1: INBOX
    ('30000001-0000-0000-0000-000000000001', '10000001-0000-0000-0000-000000000001'),

    -- Message 2: SENT
    ('30000002-0000-0000-0000-000000000002', '10000003-0000-0000-0000-000000000003'),

    -- Message 3: DRAFT
    ('30000003-0000-0000-0000-000000000003', '10000005-0000-0000-0000-000000000005'),

    -- Message 4: STARRED, INBOX
    ('30000004-0000-0000-0000-000000000004', '10000004-0000-0000-0000-000000000004'),
    ('30000004-0000-0000-0000-000000000004', '10000001-0000-0000-0000-000000000001'),

    -- Message 5: IMPORTANT, INBOX
    ('30000005-0000-0000-0000-000000000005', '10000002-0000-0000-0000-000000000002'),
    ('30000005-0000-0000-0000-000000000005', '10000001-0000-0000-0000-000000000001'),

    -- Message 6: Work (user label)
    ('30000006-0000-0000-0000-000000000006', '10000007-0000-0000-0000-000000000007'),

    -- Message 7: INBOX
    ('30000007-0000-0000-0000-000000000007', '10000001-0000-0000-0000-000000000001');
