-- Fixture for testing message-level queries:
-- senders_by_message_ids, recipients_by_message_ids, labels_by_message_ids,
-- attachments_by_message_ids, draft_attachments_by_message_ids,
-- forwarded_attachments_by_message_ids, scheduled_send_times_by_message_ids,
-- attachments_by_thread_ids, contacts_by_thread_ids

-- Insert test link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user1@test.com', 'fa-user-1', 'user1@test.com', 'GMAIL', true, NOW(), NOW());

-- Insert contacts
-- c1 = alice, c2 = bob, c3 = carol
INSERT INTO email_contacts (id, link_id, email_address, name, sfs_photo_url, created_at, updated_at)
VALUES
    ('c0000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@example.com', 'Alice Smith', 'https://photos.example.com/alice.jpg', NOW(), NOW()),
    ('c0000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bob@example.com', 'Bob Jones', NULL, NOW(), NOW()),
    ('c0000003-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'carol@example.com', 'Carol White', 'https://photos.example.com/carol.jpg', NOW(), NOW());

-- Insert threads
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'thread-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('22222222-2222-2222-2222-222222222222', 'thread-2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()),
    ('33333333-3333-3333-3333-333333333333', 'thread-3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW());

-- Insert labels
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('bb000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('bb000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'IMPORTANT', 'IMPORTANT', 'Hide', 'LabelHide', 'System', NOW()),
    ('bb000003-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Label_custom', 'Work', 'Show', 'LabelShow', 'User', NOW());

-- Insert messages
-- msg1: thread 1, from alice, has from_name override, has attachments
INSERT INTO email_messages (id, provider_id, thread_id, link_id, from_contact_id, from_name, internal_date_ts, snippet, subject, is_read, is_sent, is_draft, has_attachments, created_at, updated_at)
VALUES
    ('ee000001-0000-0000-0000-000000000001', 'provider-msg-1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000001-0000-0000-0000-000000000001', 'Alice S.', '2025-01-10 10:00:00+00', 'Hello snippet', 'Hello', true, false, false, true, '2025-01-10 10:00:00+00', '2025-01-10 10:00:00+00');

-- msg2: thread 1, from bob, no from_name override
INSERT INTO email_messages (id, provider_id, thread_id, link_id, from_contact_id, internal_date_ts, snippet, subject, is_read, is_sent, is_draft, has_attachments, created_at, updated_at)
VALUES
    ('ee000002-0000-0000-0000-000000000002', 'provider-msg-2', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000002-0000-0000-0000-000000000002', '2025-01-11 11:00:00+00', 'Reply snippet', 'Re: Hello', false, true, false, false, '2025-01-11 11:00:00+00', '2025-01-11 11:00:00+00');

-- msg3: thread 2, a draft (no from_contact)
INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, snippet, subject, is_read, is_sent, is_draft, has_attachments, created_at, updated_at)
VALUES
    ('ee000003-0000-0000-0000-000000000003', 'provider-msg-3', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2025-02-01 12:00:00+00', 'Draft snippet', 'Draft subject', false, false, true, false, '2025-02-01 12:00:00+00', '2025-02-01 12:00:00+00');

-- msg4: thread 3, from alice (no from_name override, so contact.name is used)
INSERT INTO email_messages (id, provider_id, thread_id, link_id, from_contact_id, internal_date_ts, snippet, subject, is_read, is_sent, is_draft, has_attachments, created_at, updated_at)
VALUES
    ('ee000004-0000-0000-0000-000000000004', 'provider-msg-4', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000001-0000-0000-0000-000000000001', '2025-03-01 08:00:00+00', 'Thread 3 snippet', 'Thread 3 subject', true, false, false, false, '2025-03-01 08:00:00+00', '2025-03-01 08:00:00+00');

-- Recipients for msg1: bob=TO, carol=CC
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('ee000001-0000-0000-0000-000000000001', 'c0000002-0000-0000-0000-000000000002', 'TO', NULL),
    ('ee000001-0000-0000-0000-000000000001', 'c0000003-0000-0000-0000-000000000003', 'CC', 'Carol W.');

-- Recipients for msg2: alice=TO, carol=BCC
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
VALUES
    ('ee000002-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000001', 'TO', NULL),
    ('ee000002-0000-0000-0000-000000000002', 'c0000003-0000-0000-0000-000000000003', 'BCC', NULL);

-- Message labels
-- msg1: INBOX + IMPORTANT
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('ee000001-0000-0000-0000-000000000001', 'bb000001-0000-0000-0000-000000000001'),
    ('ee000001-0000-0000-0000-000000000001', 'bb000002-0000-0000-0000-000000000002');

-- msg2: INBOX + Work (user label)
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('ee000002-0000-0000-0000-000000000002', 'bb000001-0000-0000-0000-000000000001'),
    ('ee000002-0000-0000-0000-000000000002', 'bb000003-0000-0000-0000-000000000003');

-- Attachments on msg1
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES
    ('aa000001-0000-0000-0000-000000000001', 'ee000001-0000-0000-0000-000000000001', 'prov-att-1', 'document.pdf', 'application/pdf', 102400, NULL, '2025-01-10 10:00:00+00'),
    ('aa000002-0000-0000-0000-000000000002', 'ee000001-0000-0000-0000-000000000001', 'prov-att-2', 'image.png', 'image/png', 51200, 'cid-inline-1', '2025-01-10 10:01:00+00');

-- Attachment on msg4 (thread 3)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES
    ('aa000003-0000-0000-0000-000000000003', 'ee000004-0000-0000-0000-000000000004', 'prov-att-3', 'report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 204800, NULL, '2025-03-01 08:00:00+00');

-- SFS mapping for attachment aa000001
INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id, created_at)
VALUES
    ('ff000001-0000-0000-0000-000000000001', 'aa000001-0000-0000-0000-000000000001', 'ff000002-0000-0000-0000-000000000002', NOW());

-- Draft attachments for msg3 (the draft)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES
    ('dd000001-0000-0000-0000-000000000001', 'ee000003-0000-0000-0000-000000000003', 'alpha.txt', 'text/plain', 'sha256-aaa', 100, 's3://bucket/alpha.txt', NOW()),
    ('dd000002-0000-0000-0000-000000000002', 'ee000003-0000-0000-0000-000000000003', 'beta.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'sha256-bbb', 5000, 's3://bucket/beta.docx', NOW());

-- Forwarded attachments: msg3 (draft) forwards attachment aa000001 from msg1
INSERT INTO email_attachments_fwd (message_id, attachment_id, created_at)
VALUES
    ('ee000003-0000-0000-0000-000000000003', 'aa000001-0000-0000-0000-000000000001', NOW());

-- Scheduled sends
-- msg3: scheduled, not sent
INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ee000003-0000-0000-0000-000000000003', '2025-03-01 09:00:00+00', false, NOW(), NOW());

-- msg2: scheduled but already sent (should be excluded)
INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ee000002-0000-0000-0000-000000000002', '2025-01-11 12:00:00+00', true, NOW(), NOW());
