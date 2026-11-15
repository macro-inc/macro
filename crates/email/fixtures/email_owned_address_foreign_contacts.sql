-- Loaded after email_owned_address_read.sql: threads of link 0 whose
-- messages list another inbox's contacts, which no writer does (a message
-- lists only its own inbox's contacts) but no constraint prevents. Contacts
-- are written `<inbox>:<address>`; link 2 is u1's inbox, link 1 u0's second.
CREATE TEMP TABLE owned_foreign AS
SELECT thread, j, label, sender, recipient, copied,
       '2026-06-02 00:00:00+00'::timestamptz - make_interval(mins => n, hours => 1 - j) AS mts
FROM (VALUES
  -- The company's message lists only u1's contact.
  ('foreign-only', 1, 0, 'INBOX', '0:p0@other11.test', '0:u0@owned.test', NULL),
  ('foreign-only', 1, 1, 'INBOX', '2:p0@dense.test', '0:u0@owned.test', NULL),
  -- An older message lists u0's own contact; the newest lists u1's.
  ('foreign-newest', 2, 0, 'INBOX', '0:p1@dense.test', '0:u0@owned.test', NULL),
  ('foreign-newest', 2, 1, 'INBOX', '2:p1@dense.test', '0:u0@owned.test', NULL),
  -- The message with u0's own contact is spam, which still lists the
  -- thread; the newest lists u1's.
  ('junk-and-foreign', 3, 0, 'SPAM', '0:p2@dense.test', '0:u0@owned.test', NULL),
  ('junk-and-foreign', 3, 1, 'INBOX', '2:p2@dense.test', '0:u0@owned.test', NULL),
  -- The message with u0's own contact is in trash, which doesn't.
  ('trash-and-foreign', 4, 0, 'TRASH', '0:p0@dense.test', '0:u0@owned.test', NULL),
  ('trash-and-foreign', 4, 1, 'INBOX', '2:p0@dense.test', '0:u0@owned.test', NULL),
  -- A contact of u0's second inbox, on a message of the first.
  ('second-inbox-contact', 5, 0, 'INBOX', '1:p0@dense.test', '0:u0@owned.test', NULL),
  -- u1's contact is only copied.
  ('foreign-copy', 6, 0, 'INBOX', '0:p0@other12.test', '0:u0@owned.test', '2:p1@dense.test'),
  -- u1's contact is only a recipient.
  ('foreign-recipient', 7, 0, 'SENT', '0:u0@owned.test', '2:p2@dense.test', NULL),
  -- u0's own contact matches; an unrelated contact of u1 is copied.
  ('own-match-foreign-copy', 8, 0, 'INBOX', '0:p1@dense.test', '0:u0@owned.test', '2:p0@cc.test')
) AS foreign_message(thread, n, j, label, sender, recipient, copied);

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
  latest_non_spam_message_ts, created_at, updated_at, is_signal)
SELECT md5('owned-foreign:' || thread)::uuid, 'pf-owned:' || thread, 'f1000000-0000-0000-0000-000000000000', true, false,
       max(mts) FILTER (WHERE label <> 'SENT'), max(mts) FILTER (WHERE label <> 'SPAM'), min(mts),
       max(mts) + interval '1 minute', false
FROM owned_foreign
GROUP BY thread;

INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, subject, snippet,
  from_contact_id, is_sent, is_draft, is_starred, is_read, global_id, created_at, updated_at)
SELECT md5('owned-foreign:' || thread || ':' || j)::uuid, 'pm-owned:foreign:' || thread || ':' || j,
       md5('owned-foreign:' || thread)::uuid, 'f1000000-0000-0000-0000-000000000000', mts,
       'Subject ' || thread, 'Snippet ' || thread || ':' || j,
       md5('owned-contact' || split_part(sender, ':', 1) || split_part(sender, ':', 2))::uuid,
       label = 'SENT', false, false, false, '<owned-foreign-' || thread || '-' || j || '@mail.test>', mts, mts
FROM owned_foreign;

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT md5('owned-foreign:' || thread || ':' || j)::uuid,
       md5('owned-contact' || split_part(recipient, ':', 1) || split_part(recipient, ':', 2))::uuid,
       'TO'::email_recipient_type
FROM owned_foreign
UNION ALL
SELECT md5('owned-foreign:' || thread || ':' || j)::uuid,
       md5('owned-contact' || split_part(copied, ':', 1) || split_part(copied, ':', 2))::uuid,
       'CC'::email_recipient_type
FROM owned_foreign
WHERE copied IS NOT NULL;

INSERT INTO email_message_labels (message_id, label_id)
SELECT md5('owned-foreign:' || thread || ':' || j)::uuid, md5('owned-label0' || label)::uuid
FROM owned_foreign;

DROP TABLE owned_foreign;
