-- Fixture for the team-scoped (CRM) All Mail read: one team's mail at a
-- size where both of its streams, the dedupe and the privacy rule all have
-- work to do. Generated, so the parity tests compare whole result pages.
--
--   • Team Gamma: u0 (owner, the caller), u1, u2 contribute; u3 is a member
--     without consent. u0 also has a non-primary link. u4 is not a member.
--   • Each link holds threads over a few weeks, one to three messages each.
--     Conversation k is shared: u1 holds k % 10 = 0 (joining k % 20 = 0
--     after its first message, so those copies don't dedupe) and about half
--     the rest; u2 holds k % 30 = 0 and about a third.
--   • Domains: dense.test in about 40% of threads, sparse.test in 2%, old.test
--     only in the oldest, blocked.test (team blocklist), mail.hidden.test (a
--     subdomain of a hidden company's domain), personal.test (u1's personal
--     blocklist), and other*.test.
--   • Drafts, trashed and spam messages, Signal threads, conversations with
--     no Message-ID, and one whose Message-ID is another copy's thread id.

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
SELECT md5('user' || i)::uuid, 'u' || i || '@gamma.test', 'u' || i || '@gamma.test', 'stripe_u' || i
FROM generate_series(0, 4) i;

INSERT INTO "User" (id, email, name, macro_user_id)
SELECT 'macro|u' || i || '@gamma.test', 'u' || i || '@gamma.test', 'U' || i, md5('user' || i)::uuid
FROM generate_series(0, 4) i;

INSERT INTO team (id, name, owner_id, seat_count)
VALUES ('e0000003-0000-0000-0000-000000000003', 'Team Gamma', 'macro|u0@gamma.test', 4);

INSERT INTO team_user (team_id, user_id, team_role)
SELECT 'e0000003-0000-0000-0000-000000000003', 'macro|u' || i || '@gamma.test',
       CASE WHEN i = 0 THEN 'owner' ELSE 'member' END::team_role
FROM generate_series(0, 3) i;

INSERT INTO team_crm_settings (team_id, crm_enabled)
VALUES ('e0000003-0000-0000-0000-000000000003', TRUE);

-- Links 0-4 are each user's primary inbox; link 5 is u0's second inbox.
CREATE TEMP TABLE gamma_link AS
SELECT i, ('f0000000-0000-0000-0000-00000000000' || i)::uuid AS id,
       'macro|u' || i || '@gamma.test' AS macro_id, 'u' || i || '@gamma.test' AS email
FROM generate_series(0, 4) i
UNION ALL
SELECT 5, 'f0000000-0000-0000-0000-000000000005', 'macro|u0@gamma.test', 'u0.personal@else.test';

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
SELECT id, macro_id, 'fa_u' || i, email, 'GMAIL', true, NOW(), NOW() FROM gamma_link;

INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled)
SELECT 'e0000003-0000-0000-0000-000000000003', macro_id, id, TRUE FROM gamma_link WHERE i < 3;

INSERT INTO crm_blocked_domains (team_id, domain)
VALUES ('e0000003-0000-0000-0000-000000000003', 'blocked.test');
INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain)
VALUES ('e0000003-0000-0000-0000-000000000003', 'macro|u1@gamma.test', 'personal.test');
INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction)
VALUES ('c3000000-0000-0000-0000-000000000001', 'e0000003-0000-0000-0000-000000000003', false, NOW(), NOW()),
       ('c3000000-0000-0000-0000-000000000002', 'e0000003-0000-0000-0000-000000000003', true, NOW(), NOW());
INSERT INTO crm_domains (company_id, domain, team_id)
VALUES ('c3000000-0000-0000-0000-000000000001', 'Hidden.test', 'e0000003-0000-0000-0000-000000000003'),
       ('c3000000-0000-0000-0000-000000000002', 'dense.test', 'e0000003-0000-0000-0000-000000000003');

-- Every address each inbox knows.
CREATE TEMP TABLE gamma_address AS
SELECT 'u' || i || '@gamma.test' AS email FROM generate_series(0, 4) i
UNION ALL SELECT 'u0.personal@else.test'
UNION ALL SELECT 'p' || n || '@dense.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@sparse.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@old.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@other' || k || '.test' FROM generate_series(0, 2) n, generate_series(0, 49) k
UNION ALL SELECT 'p' || n || '@blocked.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@mail.hidden.test' FROM generate_series(0, 2) n
UNION ALL SELECT 'p' || n || '@personal.test' FROM generate_series(0, 2) n;

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
SELECT md5('contact' || l.i || a.email)::uuid, l.id, a.email, NULL, NOW(), NOW()
FROM gamma_link l CROSS JOIN gamma_address a;

-- Uniform draws in [0, 1) per conversation.
CREATE TEMP TABLE gamma_draw AS
SELECT k,
       (get_byte(decode(md5(k || ':domain'), 'hex'), 0) * 256
        + get_byte(decode(md5(k || ':domain'), 'hex'), 1)) / 65536.0 AS domain_draw,
       get_byte(decode(md5(k || ':u1'), 'hex'), 0) / 256.0 AS u1_draw,
       get_byte(decode(md5(k || ':u2'), 'hex'), 0) / 256.0 AS u2_draw
FROM generate_series(0, 599) k;

-- Conversation k is newest at k = 0. Copies of one conversation share k.
CREATE TEMP TABLE gamma_thread AS
SELECT l.i, l.id AS link_id, d.k,
       md5('thread' || l.i || ':' || d.k)::uuid AS id,
       '2026-06-01 00:00:00+00'::timestamptz - make_interval(mins => d.k * 50 + l.i) AS ts,
       1 + (d.k % 3) AS nmsg,
       CASE
         WHEN d.k = 7 THEN 'dense.test'
         WHEN d.k >= 500 AND d.k % 2 = 0 THEN 'old.test'
         WHEN d.domain_draw < 0.40 THEN 'dense.test'
         WHEN d.domain_draw < 0.42 THEN 'sparse.test'
         WHEN d.domain_draw < 0.44 THEN 'blocked.test'
         WHEN d.domain_draw < 0.46 THEN 'mail.hidden.test'
         WHEN d.domain_draw < 0.48 THEN 'personal.test'
         ELSE 'other' || (d.k % 50) || '.test'
       END AS dom
FROM gamma_link l
JOIN gamma_draw d
  ON l.i IN (0, 3)
  OR (l.i = 1 AND (d.k % 10 = 0 OR d.u1_draw < 0.5))
  OR (l.i = 2 AND (d.k % 30 = 0 OR d.k = 7 OR d.u2_draw < 0.3))
  OR (l.i IN (4, 5) AND d.k % 4 = 0);
-- Unshared copies get conversations of their own.
UPDATE gamma_thread SET k = k + 1000 * i
WHERE i IN (1, 2) AND NOT (i = 1 AND k % 10 = 0) AND NOT (i = 2 AND (k % 30 = 0 OR k = 7));
UPDATE gamma_thread SET k = k + 1000 * i WHERE i >= 3;

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
  latest_non_spam_message_ts, created_at, updated_at, is_signal)
SELECT id, 'pt' || i || ':' || k, link_id, true, false, ts,
       CASE WHEN k % 151 = 3 THEN NULL ELSE ts END, ts, ts + interval '1 minute', k % 5 = 0
FROM gamma_thread;

CREATE TEMP TABLE gamma_message AS
SELECT t.*, j,
       md5('message' || t.i || ':' || t.k || ':' || j)::uuid AS mid,
       t.ts - make_interval(hours => t.nmsg - 1 - j) AS mts,
       (j % 2 = 1) AS outbound,
       (t.k % 200 = 0 AND j = t.nmsg - 1 AND t.nmsg > 1) AS draft,
       CASE
         WHEN t.k % 97 = 0 THEN NULL
         -- Conversation 7: u0's copy has no Message-ID, so its key is its
         -- thread id, and u2's copy names that id.
         WHEN t.k = 7 AND t.i = 0 THEN NULL
         WHEN t.k = 7 AND j = 0 THEN md5('thread0:7')::uuid::text
         ELSE '<g' || t.k || '-' || j || '@mail.test>'
       END AS gid,
       'p' || (t.k % 3) || '@' || t.dom AS counterpart
FROM gamma_thread t
CROSS JOIN LATERAL generate_series(0, t.nmsg - 1) j
WHERE NOT (t.i = 1 AND t.k % 20 = 0 AND j = 0 AND t.nmsg > 1);

INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts, subject, snippet,
  from_contact_id, is_sent, is_draft, is_starred, is_read, global_id, created_at, updated_at)
SELECT m.mid, 'pm' || m.i || ':' || m.k || ':' || m.j, m.id, m.link_id, m.mts,
       'Subject ' || m.k, 'Snippet ' || m.k || ':' || m.j,
       CASE WHEN m.draft THEN NULL ELSE c.id END, m.outbound AND NOT m.draft, m.draft, false, false,
       CASE WHEN m.draft THEN NULL ELSE m.gid END, m.mts, m.mts
FROM gamma_message m
JOIN gamma_link l ON l.i = m.i
JOIN email_contacts c ON c.link_id = m.link_id
 AND c.email_address = CASE WHEN m.outbound THEN l.email ELSE m.counterpart END;

-- Inbound mail is to the owner, outbound to the counterpart; some copy a
-- teammate.
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT m.mid, c.id, 'TO'::email_recipient_type
FROM gamma_message m
JOIN gamma_link l ON l.i = m.i
JOIN email_contacts c ON c.link_id = m.link_id
 AND c.email_address = CASE WHEN m.outbound THEN m.counterpart ELSE l.email END
UNION ALL
SELECT m.mid, c.id, 'CC'::email_recipient_type
FROM gamma_message m
JOIN email_contacts c ON c.link_id = m.link_id AND c.email_address = 'u' || ((m.i + 1) % 4) || '@gamma.test'
WHERE m.k % 7 = 0;

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
SELECT md5('label' || l.i || x.name)::uuid, l.id, x.name, x.name, 'Show', 'LabelShow', 'System', NOW()
FROM gamma_link l CROSS JOIN (VALUES ('INBOX'), ('SENT'), ('TRASH'), ('SPAM')) x(name);

INSERT INTO email_message_labels (message_id, label_id)
SELECT m.mid, md5('label' || m.i || CASE
         WHEN m.k % 100 = 1 THEN 'TRASH'
         WHEN m.k % 150 = 2 AND NOT m.outbound THEN 'SPAM'
         WHEN m.outbound THEN 'SENT'
         ELSE 'INBOX'
       END)::uuid
FROM gamma_message m;

DROP TABLE gamma_message, gamma_thread, gamma_draw, gamma_address, gamma_link;
