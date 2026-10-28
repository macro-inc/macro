-- Extend email_thread_labels with a second inbox belonging to the same user.
-- Its distinct email_address makes the generated is_primary column false.
UPDATE email_links
SET macro_id = 'macro|user1@test.com', fusionauth_user_id = 'user1'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb';

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('cccccccc-cccc-cccc-cccc-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 'UNREAD', 'UNREAD', 'Hide', 'LabelHide', 'System', NOW());

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('33333333-3333-3333-3333-333333333333', 'thread3', 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', true, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES ('33333333-aaaa-aaaa-aaaa-333333333333', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 'msg3', true, false, false, false, false, NOW(), NOW(), NOW());
