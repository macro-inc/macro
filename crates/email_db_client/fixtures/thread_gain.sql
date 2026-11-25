-- Two inboxes with a label of the same name, and one thread of three messages:
-- an older one labeled Finance, a newer one without labels, and a draft
-- labeled Travel.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'macro|gain@example.com', '00000000-0000-0000-0000-0000000000a1', 'gain@example.com', 'GMAIL', true, NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000000a2', 'macro|gain@example.com', '00000000-0000-0000-0000-0000000000a1', 'other@example.com', 'OUTLOOK', true, NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, type)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Finance', 'Finance', 'User'),
       ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Travel', 'Travel', 'User'),
       ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'INBOX', 'INBOX', 'System'),
       ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a2', 'Travel', 'Travel', 'User');

INSERT INTO email_threads (id, link_id, provider_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'thread-1', true, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_draft, is_sent, is_read, is_starred, has_attachments, internal_date_ts, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'm1', false, false, true, false, false, NOW() - interval '2 days', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'm2', false, false, true, false, false, NOW() - interval '1 day', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'm3', true, false, true, false, false, NOW(), NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1'),
       ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3'),
       ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b2');
