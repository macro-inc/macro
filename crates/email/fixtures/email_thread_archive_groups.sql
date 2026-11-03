-- A second inbox thread on the primary link, so one bulk archive write spans
-- two threads.
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts, created_at, updated_at)
VALUES ('77777777-7777-7777-7777-777777777777', 'thread7', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, '2025-01-01T12:00:00Z', NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES ('77777777-aaaa-aaaa-aaaa-777777777777', '77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg7', false, false, false, false, false, '2025-01-01T12:00:00Z', NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('77777777-aaaa-aaaa-aaaa-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
