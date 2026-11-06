-- Outlook mailbox. Outlook links have no system label rows; folder membership
-- lives in mailbox_state.
-- Thread 1: one received message in the Inbox folder.
-- Thread 2: one sent message in Sent Items, never received.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('0a000000-0000-0000-0000-000000000001', 'macro|user1@test.com', 'user1', 'user1@test.com', 'OUTLOOK', true, NOW(), NOW());

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('0a000000-0000-0000-0000-0000000000a1', 'outlook-conversation-1', '0a000000-0000-0000-0000-000000000001', true, true, NOW(), NOW()),
    ('0a000000-0000-0000-0000-0000000000a2', 'outlook-conversation-2', '0a000000-0000-0000-0000-000000000001', false, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, mailbox_state, created_at, updated_at)
VALUES
    ('0a000000-0000-0000-0000-0000000000b1', '0a000000-0000-0000-0000-0000000000a1', '0a000000-0000-0000-0000-000000000001', 'outlook-message-1', true, false, false, false, false, '2025-01-01T10:00:00Z',
        '{"in_inbox":true,"in_trash":false,"in_junk":false,"attention":"primary"}', NOW(), NOW()),
    ('0a000000-0000-0000-0000-0000000000b2', '0a000000-0000-0000-0000-0000000000a2', '0a000000-0000-0000-0000-000000000001', 'outlook-message-2', true, false, true, false, false, '2025-01-01T11:00:00Z',
        '{"in_inbox":false,"in_trash":false,"in_junk":false,"attention":"primary"}', NOW(), NOW());
