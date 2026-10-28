-- Bulk mail layered on email_labels.sql, so table statistics make one
-- thread a small fraction of email_message_labels.

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
SELECT md5('bulk-thread-' || i)::uuid, 'bulk-thread-' || i, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, false, NOW(), NOW()
FROM generate_series(1, 1000) i;

INSERT INTO email_messages (id, thread_id, link_id, provider_id, created_at, updated_at)
SELECT md5('bulk-message-' || i)::uuid, md5('bulk-thread-' || i)::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bulk-message-' || i, NOW(), NOW()
FROM generate_series(1, 1000) i;

INSERT INTO email_message_labels (message_id, label_id)
SELECT md5('bulk-message-' || i)::uuid, label_id
FROM generate_series(1, 1000) i
CROSS JOIN (VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid), ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid)) labels(label_id);

ANALYZE email_threads, email_messages, email_message_labels, email_labels;
