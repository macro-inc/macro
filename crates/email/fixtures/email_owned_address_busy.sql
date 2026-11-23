-- Loaded after email_owned_address_read.sql: a busy company, busy.test, on
-- nine threads of link 0 among its newest 50, each of 600 messages from
-- p0@busy.test. Its superset (5,400 rows) is past the default first probe,
-- and no older thread lists it, so a page's last rows are all near the top
-- of the inbox and the walk below them finds nothing.
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES (md5('owned-contact0p0@busy.test')::uuid, 'f1000000-0000-0000-0000-000000000000',
        'p0@busy.test', NULL, NOW(), NOW());

-- Thread n sits between conversations 5n + 2 and 5n + 3 of link 0.
CREATE TEMP TABLE owned_busy AS
SELECT n, md5('owned-busy:' || n)::uuid AS id,
       '2026-06-01 00:00:00+00'::timestamptz - make_interval(mins => (5 * n + 2) * 50 + 25) AS ts
FROM generate_series(0, 8) n;

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
  latest_non_spam_message_ts, created_at, updated_at, is_signal)
SELECT id, 'pb-owned:' || n, 'f1000000-0000-0000-0000-000000000000', true, false, ts, ts,
       ts - interval '600 seconds', ts + interval '1 minute', false
FROM owned_busy;

CREATE TEMP TABLE owned_busy_message AS
SELECT b.n, b.id AS thread_id, j, md5('owned-busy:' || b.n || ':' || j)::uuid AS mid,
       b.ts - make_interval(secs => j) AS mts
FROM owned_busy b
CROSS JOIN generate_series(0, 599) j;

INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, subject, snippet,
  from_contact_id, is_sent, is_draft, is_starred, is_read, global_id, created_at, updated_at)
SELECT mid, 'pm-owned:busy:' || n || ':' || j, thread_id, 'f1000000-0000-0000-0000-000000000000', mts,
       'Subject busy ' || n, 'Snippet busy ' || n || ':' || j, md5('owned-contact0p0@busy.test')::uuid,
       false, false, false, false, '<owned-busy-' || n || '-' || j || '@mail.test>', mts, mts
FROM owned_busy_message;

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT mid, md5('owned-contact0u0@owned.test')::uuid, 'TO'::email_recipient_type
FROM owned_busy_message;

INSERT INTO email_message_labels (message_id, label_id)
SELECT mid, md5('owned-label0INBOX')::uuid
FROM owned_busy_message;

DROP TABLE owned_busy_message, owned_busy;
