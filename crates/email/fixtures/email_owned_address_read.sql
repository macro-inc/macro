-- Fixture for the owned All Mail address read: one user's mail at a size
-- where both of its streams have work to do. Generated, so the parity tests
-- compare whole result pages.
--
--   • u0 (the caller) has a primary inbox (link 0) and a second inbox
--     (link 1). u1 owns link 2, which holds mail on the same domains and
--     addresses and is never read.
--   • Link 0 holds 600 threads over a few weeks, one to three messages
--     each; link 1 holds a quarter as many and link 2 a third.
--   • Domains: dense.test in about 40% of threads, sparse.test in 2%,
--     old.test only in the oldest, and other*.test. cc.test is only ever
--     copied and bcc.test only ever blind-copied. Each inbox knows every
--     address but only.u1@solo.test, which only link 2 knows.
--   • Drafts, trashed, spam and provider-missing messages, Signal, read,
--     done and attachment threads, and threads whose non-spam timestamp is
--     NULL.
--   • Equal thread timestamps: conversation k ties with k - 1 in link 0 when
--     k % 10 = 1, and link 1's thread ties with link 0's when k % 8 = 0.
--   • Calendar threads, u0's view history, notification states, a select
--     property, and a project u1 shares with u0 that holds threads of links
--     0 and 2.
--   • A few threads of link 0 written by hand where only a message the view
--     hides carries the participant (see the end).

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
SELECT md5('owned-user' || i)::uuid, 'u' || i || '@owned.test', 'u' || i || '@owned.test', 'stripe_owned_u' || i
FROM generate_series(0, 1) i;

INSERT INTO "User" (id, email, name, macro_user_id)
SELECT 'macro|u' || i || '@owned.test', 'u' || i || '@owned.test', 'U' || i, md5('owned-user' || i)::uuid
FROM generate_series(0, 1) i;

CREATE TEMP TABLE owned_link AS
SELECT i, ('f1000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid AS id,
       'macro|u' || u || '@owned.test' AS macro_id, email
FROM (VALUES (0, 0, 'u0@owned.test'), (1, 0, 'u0.second@else.test'),
             (2, 1, 'u1@owned.test')) AS link(i, u, email);

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active,
  created_at, updated_at)
SELECT id, macro_id, 'fa_owned_u' || i, email, 'GMAIL', true, NOW(), NOW()
FROM owned_link;

-- Every address each inbox knows.
CREATE TEMP TABLE owned_address AS
SELECT email FROM owned_link
UNION ALL SELECT 'p' || n || '@dense.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@sparse.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@old.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p0@cc.test'
UNION ALL SELECT 'p0@bcc.test'
UNION ALL SELECT 'p' || n || '@other' || k || '.test' FROM generate_series(0, 2) n, generate_series(0, 29) k;

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
SELECT md5('owned-contact' || l.i || a.email)::uuid, l.id, a.email, NULL, NOW(), NOW()
FROM owned_link l CROSS JOIN owned_address a
UNION ALL
SELECT md5('owned-contact2only.u1@solo.test')::uuid, id, 'only.u1@solo.test', NULL, NOW(), NOW()
FROM owned_link WHERE i = 2;

-- A uniform draw in [0, 1) per conversation.
CREATE TEMP TABLE owned_draw AS
SELECT k,
       (get_byte(decode(md5(k || ':owned-domain'), 'hex'), 0) * 256
        + get_byte(decode(md5(k || ':owned-domain'), 'hex'), 1)) / 65536.0 AS domain_draw
FROM generate_series(0, 599) k;

-- Conversation k is newest at k = 0. The other inboxes' threads get
-- conversation numbers of their own.
CREATE TEMP TABLE owned_thread AS
SELECT l.i, l.id AS link_id, d.k + 1000 * l.i AS k,
       md5('owned-thread' || l.i || ':' || d.k)::uuid AS id,
       '2026-06-01 00:00:00+00'::timestamptz - make_interval(
         mins => (d.k - (d.k % 10 = 1)::int) * 50 + CASE WHEN d.k % 8 = 0 THEN 0 ELSE l.i * 7 END
       ) AS ts,
       1 + (d.k % 3) AS nmsg,
       CASE
         WHEN d.k >= 500 AND d.k % 2 = 0 THEN 'old.test'
         WHEN d.domain_draw < 0.40 THEN 'dense.test'
         WHEN d.domain_draw < 0.42 THEN 'sparse.test'
         ELSE 'other' || (d.k % 30) || '.test'
       END AS dom
FROM owned_link l
JOIN owned_draw d
  ON l.i = 0 OR (l.i = 1 AND d.k % 4 = 0) OR (l.i = 2 AND d.k % 3 = 0);

-- u1's project, shared with u0, holding threads of links 0 and 2.
INSERT INTO "Project" (id, name, "userId")
VALUES (md5('owned-project')::uuid::text, 'Shared', 'macro|u1@owned.test');

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES (md5('owned-project')::uuid, 'project', 'macro|u0@owned.test', 'user', 'view');

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
  latest_non_spam_message_ts, created_at, updated_at, is_signal, has_pdf_attachment,
  has_calendar_attachment, project_id)
SELECT id, 'pt-owned' || i || ':' || k, link_id, k % 9 <> 0, k % 3 = 1, ts,
       CASE WHEN k % 151 = 3 THEN NULL ELSE ts END, ts, ts + interval '1 minute', k % 5 = 0,
       k % 6 = 0, k % 13 = 0,
       CASE WHEN k % 7 = 3 AND i <> 1 THEN md5('owned-project')::uuid::text END
FROM owned_thread;

-- u0's view history, out of the threads' order.
INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
SELECT link_id, id, ts, ts + make_interval(hours => (k * 7) % 61)
FROM owned_thread
WHERE i < 2 AND k % 5 = 1;

-- u0's notifications on some of link 0's threads, one in each state.
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
SELECT md5('owned-notification' || k)::uuid, 'new_email', id::text, 'email_thread', 'email'
FROM owned_thread
WHERE i = 0 AND k % 4 = 2;

INSERT INTO user_notification (user_id, notification_id, state, deleted_at)
SELECT 'macro|u0@owned.test', md5('owned-notification' || k)::uuid,
       (ARRAY['unseen', 'seen', 'done'])[1 + k % 3]::notification_state,
       CASE WHEN k % 20 = 10 THEN NOW() END
FROM owned_thread
WHERE i = 0 AND k % 4 = 2;

-- A select property on some threads of both inboxes.
INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES (md5('owned-property')::uuid, 'macro|u0@owned.test', 'Deal phase', 'SELECT_STRING', false, 'THREAD');

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT md5('owned-property' || id::text)::uuid, id::text, 'THREAD', md5('owned-property')::uuid,
       jsonb_build_object('type', 'SelectOption', 'value',
         jsonb_build_array(md5('owned-option' || (k % 2))::uuid::text))
FROM owned_thread
WHERE i < 2 AND k % 6 = 3;

CREATE TEMP TABLE owned_message AS
SELECT t.*, j,
       md5('owned-message' || t.i || ':' || t.k || ':' || j)::uuid AS mid,
       t.ts - make_interval(hours => t.nmsg - 1 - j) AS mts,
       (j % 2 = 1) AS outbound,
       (t.k % 200 = 0 AND j = t.nmsg - 1 AND t.nmsg > 1) AS draft,
       'p' || (t.k % 3) || '@' || t.dom AS counterpart
FROM owned_thread t
CROSS JOIN LATERAL generate_series(0, t.nmsg - 1) j;

INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, subject, snippet,
  from_contact_id, is_sent, is_draft, is_starred, is_read, global_id, created_at, updated_at,
  mailbox_state)
SELECT m.mid, 'pm-owned' || m.i || ':' || m.k || ':' || m.j, m.id, m.link_id, m.mts,
       'Subject ' || m.k, 'Snippet ' || m.k || ':' || m.j,
       c.id, m.outbound AND NOT m.draft, m.draft, false, false,
       CASE WHEN m.draft THEN NULL ELSE '<o' || m.k || '-' || m.j || '@mail.test>' END, m.mts, m.mts,
       CASE WHEN m.k % 173 = 5 AND m.j = 0 THEN '{"provider_missing": true}'::jsonb END
FROM owned_message m
JOIN owned_link l ON l.i = m.i
JOIN email_contacts c ON c.link_id = m.link_id
 AND c.email_address = CASE WHEN m.outbound THEN l.email ELSE m.counterpart END;

-- Inbound mail is to the owner, outbound to the counterpart; some is copied
-- to cc.test, and some outbound mail blind-copied to bcc.test.
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT m.mid, c.id, 'TO'::email_recipient_type
FROM owned_message m
JOIN owned_link l ON l.i = m.i
JOIN email_contacts c ON c.link_id = m.link_id
 AND c.email_address = CASE WHEN m.outbound THEN m.counterpart ELSE l.email END
UNION ALL
SELECT m.mid, c.id, 'CC'::email_recipient_type
FROM owned_message m
JOIN email_contacts c ON c.link_id = m.link_id AND c.email_address = 'p0@cc.test'
WHERE m.k % 7 = 0
UNION ALL
SELECT m.mid, c.id, 'BCC'::email_recipient_type
FROM owned_message m
JOIN email_contacts c ON c.link_id = m.link_id AND c.email_address = 'p0@bcc.test'
WHERE m.k % 11 = 0 AND m.outbound;

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
SELECT md5('owned-label' || l.i || x.name)::uuid, l.id, x.name, x.name, 'Show', 'LabelShow', 'System', NOW()
FROM owned_link l CROSS JOIN (VALUES ('INBOX'), ('SENT'), ('TRASH'), ('SPAM')) x(name);

INSERT INTO email_message_labels (message_id, label_id)
SELECT m.mid, md5('owned-label' || m.i || CASE
         WHEN m.k % 100 = 1 THEN 'TRASH'
         WHEN m.k % 150 = 2 AND NOT m.outbound THEN 'SPAM'
         WHEN m.outbound THEN 'SENT'
         ELSE 'INBOX'
       END)::uuid
FROM owned_message m;

-- Link 0's threads where the dense.test participant is only on a message
-- All Mail hides, or where the newest message is one it hides.
CREATE TEMP TABLE owned_hand AS
SELECT thread, j, draft, label, missing, sender, recipient,
       '2026-06-01 00:00:00+00'::timestamptz - make_interval(mins => n, hours => 1 - j) AS mts
FROM (VALUES
  -- Only a spam message is from the company.
  ('spam-only', 20, 0, false, 'INBOX', false, 'p0@other7.test', 'u0@owned.test'),
  ('spam-only', 20, 1, false, 'SPAM', false, 'p2@dense.test', 'u0@owned.test'),
  -- Only a trashed message is to the company.
  ('trash-only', 21, 0, false, 'INBOX', false, 'p0@other8.test', 'u0@owned.test'),
  ('trash-only', 21, 1, false, 'TRASH', false, 'u0@owned.test', 'p1@dense.test'),
  -- Only a message the provider no longer has is from the company.
  ('missing-only', 22, 0, false, 'INBOX', false, 'p0@other9.test', 'u0@owned.test'),
  ('missing-only', 22, 1, false, 'INBOX', true, 'p0@dense.test', 'u0@owned.test'),
  -- The company is only on a draft.
  ('draft-only', 23, 0, false, 'INBOX', false, 'p0@other10.test', 'u0@owned.test'),
  ('draft-only', 23, 1, true, 'SENT', false, 'u0@owned.test', 'p1@dense.test'),
  -- The newest message is spam from the company; the preview is the one
  -- before it.
  ('spam-newest', 24, 0, false, 'INBOX', false, 'p1@dense.test', 'u0@owned.test'),
  ('spam-newest', 24, 1, false, 'SPAM', false, 'p1@dense.test', 'u0@owned.test')
) AS hand(thread, n, j, draft, label, missing, sender, recipient);

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
  latest_non_spam_message_ts, created_at, updated_at, is_signal)
SELECT md5('owned-hand:' || thread)::uuid, 'ph-owned:' || thread, 'f1000000-0000-0000-0000-000000000000', true, false,
       max(mts) FILTER (WHERE NOT draft), max(mts) FILTER (WHERE label <> 'SPAM'), min(mts),
       max(mts) + interval '1 minute', false
FROM owned_hand
GROUP BY thread;

INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, subject, snippet,
  from_contact_id, is_sent, is_draft, is_starred, is_read, global_id, created_at, updated_at,
  mailbox_state)
SELECT md5('owned-hand:' || thread || ':' || j)::uuid, 'pm-owned:hand:' || thread || ':' || j,
       md5('owned-hand:' || thread)::uuid, 'f1000000-0000-0000-0000-000000000000', mts,
       'Subject ' || thread, 'Snippet ' || thread || ':' || j,
       md5('owned-contact0' || sender)::uuid, label = 'SENT' AND NOT draft, draft, false, false,
       CASE WHEN NOT draft THEN '<owned-hand-' || thread || '-' || j || '@mail.test>' END, mts, mts,
       CASE WHEN missing THEN '{"provider_missing": true}'::jsonb END
FROM owned_hand;

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT md5('owned-hand:' || thread || ':' || j)::uuid, md5('owned-contact0' || recipient)::uuid, 'TO'::email_recipient_type
FROM owned_hand;

INSERT INTO email_message_labels (message_id, label_id)
SELECT md5('owned-hand:' || thread || ':' || j)::uuid, md5('owned-label0' || label)::uuid
FROM owned_hand;

DROP TABLE owned_hand, owned_message, owned_thread, owned_draw, owned_address, owned_link;
