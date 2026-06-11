-- Fixture for testing CRM-scoped dynamic queries.
--
-- Sets up:
--   • Team Alpha with two members (Alice, Bob).
--   • Carol — a non-member with her own link/threads (must never appear in
--     team-scoped results).
--   • Each link has its OWN row in email_contacts for the same external
--     address "outsider@acme.com" — different UUIDs per link. This is what
--     exercises the new multi-id `from_contact_id = ANY($ids)` predicate.
--   • Each link has a TRASH label with a different UUID. Some threads are
--     trashed in each link to exercise the multi-id trash exclusion.
--   • Threads on alice/bob's links from "outsider@acme.com" (acme.com
--     domain) plus a thread on alice's link from a different sender,
--     plus a thread on carol's link that must be excluded.

-- == macro_user / User rows ==
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'alice@team.com', 'alice@team.com', 'stripe_alice'),
    ('b1111111-1111-1111-1111-111111111111', 'bob@team.com',   'bob@team.com',   'stripe_bob'),
    ('c1111111-1111-1111-1111-111111111111', 'carol@team.com', 'carol@team.com', 'stripe_carol');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES
    ('macro|alice@team.com', 'alice@team.com', 'Alice', 'a1111111-1111-1111-1111-111111111111'),
    ('macro|bob@team.com',   'bob@team.com',   'Bob',   'b1111111-1111-1111-1111-111111111111'),
    ('macro|carol@team.com', 'carol@team.com', 'Carol', 'c1111111-1111-1111-1111-111111111111');

-- == Team Alpha + memberships ==
INSERT INTO team (id, name, owner_id, seat_count)
VALUES
    ('e0000001-0000-0000-0000-000000000001', 'Team Alpha', 'macro|alice@team.com', 2);

INSERT INTO team_user (team_id, user_id, team_role)
VALUES
    ('e0000001-0000-0000-0000-000000000001', 'macro|alice@team.com', 'owner'),
    ('e0000001-0000-0000-0000-000000000001', 'macro|bob@team.com',   'member');
-- Carol is intentionally NOT a member.

-- Team-level CRM killswitch ON. The candidate-source SQL joins
-- team_crm_settings (crm_enabled = TRUE), so this row must be present
-- for any CRM-scoped query to return rows. Tests that exercise the
-- killswitch-off behavior flip this in their own fixture script.
INSERT INTO team_crm_settings (team_id, crm_enabled)
VALUES
    ('e0000001-0000-0000-0000-000000000001', TRUE);

-- == Email links (one per user) ==
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('a0000001-0000-0000-0000-000000000001', 'macro|alice@team.com', 'fa_alice', 'alice@team.com', 'GMAIL', true, NOW(), NOW()),
    ('a0000002-0000-0000-0000-000000000002', 'macro|bob@team.com',   'fa_bob',   'bob@team.com',   'GMAIL', true, NOW(), NOW()),
    ('a0000003-0000-0000-0000-000000000003', 'macro|carol@team.com', 'fa_carol', 'carol@team.com', 'GMAIL', true, NOW(), NOW());

-- == Contacts ==
-- Each link has its own row for the SAME external address. This is the
-- multi-id case the new resolution path is designed to handle.
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    -- outsider@acme.com — one contact row per link, different UUIDs
    ('c0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'outsider@acme.com', 'Outsider', NOW(), NOW()),
    ('c0000002-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002', 'outsider@acme.com', 'Outsider', NOW(), NOW()),
    ('c0000003-0000-0000-0000-000000000003', 'a0000003-0000-0000-0000-000000000003', 'outsider@acme.com', 'Outsider', NOW(), NOW()),
    -- a different sender on alice's link, for non-matching-filter assertions
    ('c0000004-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000001', 'other@elsewhere.com', 'Other', NOW(), NOW()),
    -- TO/CC/BCC recipient contacts — mirrored on both alice and bob's
    -- links (same address, different per-link UUIDs). Exercise multi-id
    -- ANY predicates on the recipient EXISTS subquery.
    ('c0000005-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000001', 'to-target@elsewhere.com',  'To Target',  NOW(), NOW()),
    ('c0000006-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000001', 'cc-target@elsewhere.com',  'Cc Target',  NOW(), NOW()),
    ('c0000007-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000001', 'bcc-target@elsewhere.com', 'Bcc Target', NOW(), NOW()),
    ('c0000008-0000-0000-0000-000000000008', 'a0000002-0000-0000-0000-000000000002', 'to-target@elsewhere.com',  'To Target',  NOW(), NOW()),
    ('c0000009-0000-0000-0000-000000000009', 'a0000002-0000-0000-0000-000000000002', 'cc-target@elsewhere.com',  'Cc Target',  NOW(), NOW()),
    ('c0000010-0000-0000-0000-000000000010', 'a0000002-0000-0000-0000-000000000002', 'bcc-target@elsewhere.com', 'Bcc Target', NOW(), NOW()),
    -- Asymmetric: only Bob has a contact row for this address.
    -- `Sender(Complete("bob-only@onlybob.com"))` under team_scope should
    -- resolve to exactly one contact id and match only bob's thread.
    ('c0000011-0000-0000-0000-000000000011', 'a0000002-0000-0000-0000-000000000002', 'bob-only@onlybob.com', 'BobOnly', NOW(), NOW());

-- == Labels — INBOX + TRASH per link ==
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    -- Alice's labels
    ('11110001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('11110001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000001', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW()),
    -- Bob's labels
    ('11110002-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000002', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('11110002-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW()),
    -- Carol's labels
    ('11110003-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000003', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('11110003-0000-0000-0000-000000000002', 'a0000003-0000-0000-0000-000000000003', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW());

-- == Threads ==
-- ta1: alice's inbox thread from outsider@acme.com (will appear in team queries)
-- ta2: alice's TRASHED thread from outsider@acme.com (must NOT appear)
-- ta3: alice's inbox thread from other@elsewhere.com (no acme match)
-- tb1: bob's inbox thread from outsider@acme.com (will appear in team queries)
-- tb2: bob's TRASHED thread from outsider@acme.com (must NOT appear)
-- tc1: carol's inbox thread from outsider@acme.com (must NOT appear — not on team)
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('22220001-0000-0000-0000-000000000001', 'ta1', 'a0000001-0000-0000-0000-000000000001',
     true,  false, '2026-04-01 10:00:00+00', NULL, '2026-04-01 10:00:00+00', NOW(), NOW()),
    ('22220001-0000-0000-0000-000000000002', 'ta2', 'a0000001-0000-0000-0000-000000000001',
     true,  false, '2026-04-02 10:00:00+00', NULL, '2026-04-02 10:00:00+00', NOW(), NOW()),
    ('22220001-0000-0000-0000-000000000003', 'ta3', 'a0000001-0000-0000-0000-000000000001',
     true,  false, '2026-04-03 10:00:00+00', NULL, '2026-04-03 10:00:00+00', NOW(), NOW()),
    ('22220002-0000-0000-0000-000000000001', 'tb1', 'a0000002-0000-0000-0000-000000000002',
     true,  false, '2026-04-04 10:00:00+00', NULL, '2026-04-04 10:00:00+00', NOW(), NOW()),
    ('22220002-0000-0000-0000-000000000002', 'tb2', 'a0000002-0000-0000-0000-000000000002',
     true,  false, '2026-04-05 10:00:00+00', NULL, '2026-04-05 10:00:00+00', NOW(), NOW()),
    ('22220003-0000-0000-0000-000000000001', 'tc1', 'a0000003-0000-0000-0000-000000000003',
     true,  false, '2026-04-06 10:00:00+00', NULL, '2026-04-06 10:00:00+00', NOW(), NOW()),
    -- tb3: bob's inbox thread from bob-only@onlybob.com (asymmetric test).
    ('22220002-0000-0000-0000-000000000003', 'tb3', 'a0000002-0000-0000-0000-000000000002',
     true,  false, '2026-04-07 10:00:00+00', NULL, '2026-04-07 10:00:00+00', NOW(), NOW());

-- == Messages ==
INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    -- ta1 — alice's inbox, from outsider@acme.com (alice's contact row)
    ('33330001-0000-0000-0000-000000000001', '22220001-0000-0000-0000-000000000001',
     'a0000001-0000-0000-0000-000000000001', 'ma1', 'c0000001-0000-0000-0000-000000000001',
     'Alice inbox acme', 'alice from acme', '2026-04-01 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- ta2 — alice's TRASHED, from outsider@acme.com (alice's contact row)
    ('33330001-0000-0000-0000-000000000002', '22220001-0000-0000-0000-000000000002',
     'a0000001-0000-0000-0000-000000000001', 'ma2', 'c0000001-0000-0000-0000-000000000001',
     'Alice trash acme', 'alice trashed acme', '2026-04-02 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- ta3 — alice's inbox, from other@elsewhere.com (not an acme address)
    ('33330001-0000-0000-0000-000000000003', '22220001-0000-0000-0000-000000000003',
     'a0000001-0000-0000-0000-000000000001', 'ma3', 'c0000004-0000-0000-0000-000000000004',
     'Alice inbox other', 'alice from elsewhere', '2026-04-03 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- tb1 — bob's inbox, from outsider@acme.com (bob's contact row)
    ('33330002-0000-0000-0000-000000000001', '22220002-0000-0000-0000-000000000001',
     'a0000002-0000-0000-0000-000000000002', 'mb1', 'c0000002-0000-0000-0000-000000000002',
     'Bob inbox acme', 'bob from acme', '2026-04-04 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- tb2 — bob's TRASHED, from outsider@acme.com (bob's contact row)
    ('33330002-0000-0000-0000-000000000002', '22220002-0000-0000-0000-000000000002',
     'a0000002-0000-0000-0000-000000000002', 'mb2', 'c0000002-0000-0000-0000-000000000002',
     'Bob trash acme', 'bob trashed acme', '2026-04-05 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- tc1 — carol's inbox, from outsider@acme.com (carol's contact row)
    ('33330003-0000-0000-0000-000000000001', '22220003-0000-0000-0000-000000000001',
     'a0000003-0000-0000-0000-000000000003', 'mc1', 'c0000003-0000-0000-0000-000000000003',
     'Carol inbox acme', 'carol from acme', '2026-04-06 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- mb3 — bob's inbox thread tb3, from bob-only@onlybob.com (only on bob's link)
    ('33330002-0000-0000-0000-000000000003', '22220002-0000-0000-0000-000000000003',
     'a0000002-0000-0000-0000-000000000002', 'mb3', 'c0000011-0000-0000-0000-000000000011',
     'Bob inbox bob-only', 'bob from bob-only', '2026-04-07 10:00:00+00',
     false, false, false, false, NOW(), NOW());

-- == Recipients ==
-- ta1 and tb1 both have the same TO/CC/BCC addresses, but each link has
-- its own contact row for those addresses (different UUIDs). The recipient
-- ANY-predicate must match both via multi-id resolution.
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    -- ta1 recipients (alice's link)
    ('33330001-0000-0000-0000-000000000001', 'c0000005-0000-0000-0000-000000000005', 'TO'),
    ('33330001-0000-0000-0000-000000000001', 'c0000006-0000-0000-0000-000000000006', 'CC'),
    ('33330001-0000-0000-0000-000000000001', 'c0000007-0000-0000-0000-000000000007', 'BCC'),
    -- tb1 recipients (bob's link)
    ('33330002-0000-0000-0000-000000000001', 'c0000008-0000-0000-0000-000000000008', 'TO'),
    ('33330002-0000-0000-0000-000000000001', 'c0000009-0000-0000-0000-000000000009', 'CC'),
    ('33330002-0000-0000-0000-000000000001', 'c0000010-0000-0000-0000-000000000010', 'BCC');

-- == Message labels ==
-- Inbox label on the inbox threads (per-link INBOX label uuids)
-- TRASH label on the trashed threads (per-link TRASH label uuids)
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    -- Alice INBOX
    ('33330001-0000-0000-0000-000000000001', '11110001-0000-0000-0000-000000000001'),
    ('33330001-0000-0000-0000-000000000003', '11110001-0000-0000-0000-000000000001'),
    -- Alice TRASH (ta2)
    ('33330001-0000-0000-0000-000000000002', '11110001-0000-0000-0000-000000000002'),
    -- Bob INBOX
    ('33330002-0000-0000-0000-000000000001', '11110002-0000-0000-0000-000000000001'),
    -- Bob INBOX (tb3, from bob-only@onlybob.com)
    ('33330002-0000-0000-0000-000000000003', '11110002-0000-0000-0000-000000000001'),
    -- Bob TRASH (tb2)
    ('33330002-0000-0000-0000-000000000002', '11110002-0000-0000-0000-000000000002'),
    -- Carol INBOX
    ('33330003-0000-0000-0000-000000000001', '11110003-0000-0000-0000-000000000001');

-- == Alice's connected secondary (non-primary) link ==
-- Same macro_id as alice's primary link but a different email_address — a
-- personal mailbox connected as an extra inbox. Team-scoped queries must
-- never read it: its threads, contacts, and labels stay out of CRM scope.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('a0000004-0000-0000-0000-000000000004', 'macro|alice@team.com', 'fa_alice_personal', 'alice.personal@gmail.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    -- outsider@acme.com also corresponded with alice's personal mailbox
    ('c0000012-0000-0000-0000-000000000012', 'a0000004-0000-0000-0000-000000000004', 'outsider@acme.com', 'Outsider', NOW(), NOW()),
    -- an address known ONLY to the personal mailbox
    ('c0000013-0000-0000-0000-000000000013', 'a0000004-0000-0000-0000-000000000004', 'secret@personal.com', 'Secret', NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('11110004-0000-0000-0000-000000000001', 'a0000004-0000-0000-0000-000000000004', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('11110004-0000-0000-0000-000000000002', 'a0000004-0000-0000-0000-000000000004', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW());

-- tp1: personal inbox thread from outsider@acme.com (matches CRM filters,
--      must NOT appear in team-scoped results)
-- tp2: personal inbox thread from secret@personal.com (its contact must not
--      resolve under team scope)
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('22220004-0000-0000-0000-000000000001', 'tp1', 'a0000004-0000-0000-0000-000000000004',
     true,  false, '2026-04-08 10:00:00+00', NULL, '2026-04-08 10:00:00+00', NOW(), NOW()),
    ('22220004-0000-0000-0000-000000000002', 'tp2', 'a0000004-0000-0000-0000-000000000004',
     true,  false, '2026-04-09 10:00:00+00', NULL, '2026-04-09 10:00:00+00', NOW(), NOW());

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    ('33330004-0000-0000-0000-000000000001', '22220004-0000-0000-0000-000000000001',
     'a0000004-0000-0000-0000-000000000004', 'mp1', 'c0000012-0000-0000-0000-000000000012',
     'Alice personal acme', 'personal from acme', '2026-04-08 10:00:00+00',
     false, false, false, false, NOW(), NOW()),
    ('33330004-0000-0000-0000-000000000002', '22220004-0000-0000-0000-000000000002',
     'a0000004-0000-0000-0000-000000000004', 'mp2', 'c0000013-0000-0000-0000-000000000013',
     'Alice personal secret', 'personal from secret', '2026-04-09 10:00:00+00',
     false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('33330004-0000-0000-0000-000000000001', '11110004-0000-0000-0000-000000000001'),
    ('33330004-0000-0000-0000-000000000002', '11110004-0000-0000-0000-000000000001');
