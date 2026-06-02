-- Fixture for testing team-scoped (CRM) dedupe of conversation copies.
--
-- Team Beta has two members (Dave, Erin). Four conversations, identified by
-- the root message's RFC-822 Message-ID (email_messages.global_id):
--
--   • X — BOTH have a copy. Dave's copy also has a reply Erin wasn't on,
--     so Dave's thread ts (10:00) is newer than Erin's (08:00).
--   • Y — Erin only (09:00). Dave's queries must return Erin's copy.
--   • Z — Dave only (11:00).
--   • W — BOTH have a copy. Erin's copy has a reply Dave wasn't on, so
--     Erin's thread ts (12:00) is NEWER than Dave's (07:00). Own-copy
--     preference must still pick the caller's copy over the newer one.
--
-- Expected results for Sender(Domain("acme.com")) under team scope:
--   Dave: td2(Z,11:00), td1(X,10:00), te2(Y,09:00), td3(W,07:00)
--   Erin: te3(W,12:00), td2(Z,11:00), te2(Y,09:00), te1(X,08:00)

-- == macro_user / User rows ==
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('d1111111-1111-1111-1111-111111111111', 'dave@beta.com', 'dave@beta.com', 'stripe_dave'),
    ('e1111111-1111-1111-1111-111111111111', 'erin@beta.com', 'erin@beta.com', 'stripe_erin');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES
    ('macro|dave@beta.com', 'dave@beta.com', 'Dave', 'd1111111-1111-1111-1111-111111111111'),
    ('macro|erin@beta.com', 'erin@beta.com', 'Erin', 'e1111111-1111-1111-1111-111111111111');

-- == Team Beta + memberships ==
INSERT INTO team (id, name, owner_id, seat_count)
VALUES
    ('e0000002-0000-0000-0000-000000000002', 'Team Beta', 'macro|dave@beta.com', 2);

INSERT INTO team_user (team_id, user_id, team_role)
VALUES
    ('e0000002-0000-0000-0000-000000000002', 'macro|dave@beta.com', 'owner'),
    ('e0000002-0000-0000-0000-000000000002', 'macro|erin@beta.com', 'member');

INSERT INTO team_crm_settings (team_id, crm_enabled)
VALUES
    ('e0000002-0000-0000-0000-000000000002', TRUE);

-- == Email links ==
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('d0000001-0000-0000-0000-000000000001', 'macro|dave@beta.com', 'fa_dave', 'dave@beta.com', 'GMAIL', true, NOW(), NOW()),
    ('d0000002-0000-0000-0000-000000000002', 'macro|erin@beta.com', 'fa_erin', 'erin@beta.com', 'GMAIL', true, NOW(), NOW());

-- == Contacts — vendor@acme.com, one row per link ==
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('c1000001-0000-0000-0000-000000000001', 'd0000001-0000-0000-0000-000000000001', 'vendor@acme.com', 'Vendor', NOW(), NOW()),
    ('c1000002-0000-0000-0000-000000000002', 'd0000002-0000-0000-0000-000000000002', 'vendor@acme.com', 'Vendor', NOW(), NOW());

-- == Labels — INBOX + TRASH per link ==
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('77770001-0000-0000-0000-000000000001', 'd0000001-0000-0000-0000-000000000001', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('77770001-0000-0000-0000-000000000002', 'd0000001-0000-0000-0000-000000000001', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW()),
    ('77770002-0000-0000-0000-000000000001', 'd0000002-0000-0000-0000-000000000002', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('77770002-0000-0000-0000-000000000002', 'd0000002-0000-0000-0000-000000000002', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW());

-- == Threads ==
-- td1: dave's copy of X    td2: dave's Z       td3: dave's copy of W
-- te1: erin's copy of X    te2: erin's Y       te3: erin's copy of W
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('55550001-0000-0000-0000-000000000001', 'td1', 'd0000001-0000-0000-0000-000000000001',
     true, false, '2026-05-01 10:00:00+00', NULL, '2026-05-01 10:00:00+00', NOW(), NOW()),
    ('55550001-0000-0000-0000-000000000002', 'td2', 'd0000001-0000-0000-0000-000000000001',
     true, false, '2026-05-01 11:00:00+00', NULL, '2026-05-01 11:00:00+00', NOW(), NOW()),
    ('55550001-0000-0000-0000-000000000003', 'td3', 'd0000001-0000-0000-0000-000000000001',
     true, false, '2026-05-01 07:00:00+00', NULL, '2026-05-01 07:00:00+00', NOW(), NOW()),
    ('55550002-0000-0000-0000-000000000001', 'te1', 'd0000002-0000-0000-0000-000000000002',
     true, false, '2026-05-01 08:00:00+00', NULL, '2026-05-01 08:00:00+00', NOW(), NOW()),
    ('55550002-0000-0000-0000-000000000002', 'te2', 'd0000002-0000-0000-0000-000000000002',
     true, false, '2026-05-01 09:00:00+00', NULL, '2026-05-01 09:00:00+00', NOW(), NOW()),
    ('55550002-0000-0000-0000-000000000003', 'te3', 'd0000002-0000-0000-0000-000000000002',
     true, false, '2026-05-01 12:00:00+00', NULL, '2026-05-01 12:00:00+00', NOW(), NOW());

-- == Messages ==
-- Copies of the same conversation share the root message's global_id.
INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts, global_id,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    -- X root — both copies
    ('66660001-0000-0000-0000-000000000001', '55550001-0000-0000-0000-000000000001',
     'd0000001-0000-0000-0000-000000000001', 'md1', 'c1000001-0000-0000-0000-000000000001',
     'Conv X', 'x root (dave copy)', '2026-05-01 08:00:00+00', '<x-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    ('66660002-0000-0000-0000-000000000001', '55550002-0000-0000-0000-000000000001',
     'd0000002-0000-0000-0000-000000000002', 'me1', 'c1000002-0000-0000-0000-000000000002',
     'Conv X', 'x root (erin copy)', '2026-05-01 08:00:00+00', '<x-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- X reply — dave only (erin was dropped)
    ('66660001-0000-0000-0000-000000000002', '55550001-0000-0000-0000-000000000001',
     'd0000001-0000-0000-0000-000000000001', 'md2', 'c1000001-0000-0000-0000-000000000001',
     'Conv X', 'x reply (dave only)', '2026-05-01 10:00:00+00', '<x-2@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- Y root — erin only
    ('66660002-0000-0000-0000-000000000002', '55550002-0000-0000-0000-000000000002',
     'd0000002-0000-0000-0000-000000000002', 'me2', 'c1000002-0000-0000-0000-000000000002',
     'Conv Y', 'y root (erin only)', '2026-05-01 09:00:00+00', '<y-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- Z root — dave only
    ('66660001-0000-0000-0000-000000000003', '55550001-0000-0000-0000-000000000002',
     'd0000001-0000-0000-0000-000000000001', 'md3', 'c1000001-0000-0000-0000-000000000001',
     'Conv Z', 'z root (dave only)', '2026-05-01 11:00:00+00', '<z-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- W root — both copies
    ('66660001-0000-0000-0000-000000000004', '55550001-0000-0000-0000-000000000003',
     'd0000001-0000-0000-0000-000000000001', 'md4', 'c1000001-0000-0000-0000-000000000001',
     'Conv W', 'w root (dave copy)', '2026-05-01 07:00:00+00', '<w-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    ('66660002-0000-0000-0000-000000000003', '55550002-0000-0000-0000-000000000003',
     'd0000002-0000-0000-0000-000000000002', 'me3', 'c1000002-0000-0000-0000-000000000002',
     'Conv W', 'w root (erin copy)', '2026-05-01 07:00:00+00', '<w-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- W reply — erin only (dave was dropped); makes erin's copy NEWER
    ('66660002-0000-0000-0000-000000000004', '55550002-0000-0000-0000-000000000003',
     'd0000002-0000-0000-0000-000000000002', 'me4', 'c1000002-0000-0000-0000-000000000002',
     'Conv W', 'w reply (erin only)', '2026-05-01 12:00:00+00', '<w-2@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- X draft on dave's copy — EARLIEST message in the thread WITH a
    -- global_id (provider-synced drafts carry a mailbox-local Message-ID).
    -- Root selection must skip it (is_draft = FALSE) or dave's dedupe key
    -- becomes the draft's local Message-ID and X stops deduping.
    ('66660001-0000-0000-0000-000000000005', '55550001-0000-0000-0000-000000000001',
     'd0000001-0000-0000-0000-000000000001', 'md5', NULL,
     'Conv X', 'x draft (dave only)', '2026-05-01 06:00:00+00', '<x-draft-local@dave.beta.com>',
     true, false, false, false, NOW(), NOW());

-- == Message labels — everything in INBOX, nothing trashed ==
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('66660001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000001'),
    ('66660001-0000-0000-0000-000000000002', '77770001-0000-0000-0000-000000000001'),
    ('66660001-0000-0000-0000-000000000003', '77770001-0000-0000-0000-000000000001'),
    ('66660001-0000-0000-0000-000000000004', '77770001-0000-0000-0000-000000000001'),
    ('66660002-0000-0000-0000-000000000001', '77770002-0000-0000-0000-000000000001'),
    ('66660002-0000-0000-0000-000000000002', '77770002-0000-0000-0000-000000000001'),
    ('66660002-0000-0000-0000-000000000003', '77770002-0000-0000-0000-000000000001'),
    ('66660002-0000-0000-0000-000000000004', '77770002-0000-0000-0000-000000000001');
