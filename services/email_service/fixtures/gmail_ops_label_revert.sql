-- One Gmail inbox whose three messages were archived in Macro by write
-- ...00f1, which Gmail has not confirmed yet.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'macro|revert@example.com', 'revert-user', 'revert@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'thread-1', '00000000-0000-0000-0000-0000000000a1', false, true, NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES
    ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'msg-a', true, false, false, false, false, '2026-10-01T10:00:00Z', NOW(), NOW()),
    ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'msg-b', true, false, false, false, false, '2026-10-01T11:00:00Z', NOW(), NOW()),
    ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'msg-c', true, false, false, false, false, '2026-10-01T12:00:00Z', NOW(), NOW());

INSERT INTO email_gmail_pending_label_writes (message_id, provider_label_id, write_id, label_present, label_present_before, expires_at)
VALUES
    ('00000000-0000-0000-0000-00000000000a', 'INBOX', '00000000-0000-0000-0000-0000000000f1', false, true, NOW() + interval '12 hours'),
    ('00000000-0000-0000-0000-00000000000b', 'INBOX', '00000000-0000-0000-0000-0000000000f1', false, true, NOW() + interval '12 hours'),
    ('00000000-0000-0000-0000-00000000000c', 'INBOX', '00000000-0000-0000-0000-0000000000f1', false, true, NOW() + interval '12 hours');
