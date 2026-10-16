-- SQL fixture for purge_link tests.
-- Two mailboxes with identical shapes: link a001 is purged, link b001 must be left intact.
-- Each has 4 contacts, 3 labels, 10 threads of 3 messages and 1 empty thread. Every message replies to the
-- previous one in its thread, carries 2 labels and 2 recipients; the first message of each
-- thread has an attachment stored in SFS; each thread has user history; one message is a
-- scheduled send.

CREATE TEMP TABLE purge_fixture_links (tag TEXT, id UUID);
INSERT INTO purge_fixture_links (tag, id)
VALUES ('a', '00000000-0000-0000-0000-00000000a001'),
       ('b', '00000000-0000-0000-0000-00000000b001');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
SELECT id, 'macro|purge_' || tag || '@example.com', id::text, 'purge_' || tag || '@example.com', 'GMAIL', true
FROM purge_fixture_links;

INSERT INTO email_settings (link_id)
SELECT id FROM purge_fixture_links;

INSERT INTO email_gmail_histories (link_id, history_id)
SELECT id, 'history-' || tag FROM purge_fixture_links;

INSERT INTO email_sync_tokens (link_id, contacts_sync_token)
SELECT id, 'sync-' || tag FROM purge_fixture_links;

INSERT INTO email_contacts (id, link_id, email_address)
SELECT md5(l.tag || '-contact-' || c)::uuid, l.id, 'contact' || c || '_' || l.tag || '@example.com'
FROM purge_fixture_links l, generate_series(1, 4) AS c;

INSERT INTO email_labels (id, link_id, provider_label_id, name)
SELECT md5(l.tag || '-label-' || n)::uuid, l.id, 'Label_' || n, 'Label ' || n
FROM purge_fixture_links l, generate_series(1, 3) AS n;

INSERT INTO email_threads (id, link_id, provider_id, inbox_visible)
SELECT md5(l.tag || '-thread-' || t)::uuid, l.id, l.tag || '-thread-' || t, true
FROM purge_fixture_links l, generate_series(1, 10) AS t;

-- A thread with no messages, which only the thread phase reaches.
INSERT INTO email_threads (id, link_id, provider_id)
SELECT md5(tag || '-thread-empty')::uuid, id, tag || '-thread-empty'
FROM purge_fixture_links;

INSERT INTO email_messages (id, thread_id, link_id, provider_id, from_contact_id, replying_to_id,
                            internal_date_ts, body_text)
SELECT md5(l.tag || '-msg-' || t || '-' || n)::uuid,
       md5(l.tag || '-thread-' || t)::uuid,
       l.id,
       l.tag || '-msg-' || t || '-' || n,
       md5(l.tag || '-contact-' || (1 + n % 4))::uuid,
       CASE WHEN n > 1 THEN md5(l.tag || '-msg-' || t || '-' || (n - 1))::uuid END,
       TIMESTAMPTZ '2025-01-01 00:00:00+00' + make_interval(hours => t * 10 + n),
       repeat('body ', 200)
FROM purge_fixture_links l, generate_series(1, 10) AS t, generate_series(1, 3) AS n;

INSERT INTO email_message_labels (message_id, label_id)
SELECT m.id, md5(l.tag || '-label-' || n)::uuid
FROM purge_fixture_links l
JOIN email_messages m ON m.link_id = l.id,
generate_series(1, 2) AS n;

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT m.id, md5(l.tag || '-contact-' || r.contact)::uuid, r.kind::email_recipient_type
FROM purge_fixture_links l
JOIN email_messages m ON m.link_id = l.id,
(VALUES (2, 'TO'), (3, 'CC')) AS r(contact, kind);

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes)
SELECT md5(l.tag || '-attachment-' || t)::uuid, md5(l.tag || '-msg-' || t || '-1')::uuid,
       l.tag || '-attachment-' || t, 'file' || t || '.pdf', 'application/pdf', 1024
FROM purge_fixture_links l, generate_series(1, 10) AS t;

INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id)
SELECT md5(l.tag || '-sfs-' || t)::uuid, md5(l.tag || '-attachment-' || t)::uuid,
       md5(l.tag || '-sfs-file-' || t)::uuid
FROM purge_fixture_links l, generate_series(1, 10) AS t;

INSERT INTO email_user_history (link_id, thread_id)
SELECT l.id, md5(l.tag || '-thread-' || t)::uuid
FROM purge_fixture_links l, generate_series(1, 10) AS t;

INSERT INTO email_scheduled_messages (link_id, message_id, send_time)
SELECT id, md5(tag || '-msg-1-3')::uuid, TIMESTAMPTZ '2025-02-01 00:00:00+00'
FROM purge_fixture_links;

DROP TABLE purge_fixture_links;
