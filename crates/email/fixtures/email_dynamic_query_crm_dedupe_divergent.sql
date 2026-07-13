-- Add-on to email_dynamic_query_crm_dedupe.sql (load both).
--
-- Conversation V — Dave was added MID-THREAD, so his copy lacks the root
-- message. Root-by-date keys diverge ('<v-2@...>' for dave vs '<v-1@...>'
-- for erin) and both copies are returned. This is the documented, accepted
-- degradation of root-global_id dedupe; if the key strategy changes (e.g.
-- to any-shared-message matching), this fixture's expectations must too.

-- tdv: dave's copy of V (joined at the reply)  tev: erin's copy (full)
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('55550001-0000-0000-0000-000000000004', 'tdv', 'd0000001-0000-0000-0000-000000000001',
     true, false, '2026-05-01 13:00:00+00', NULL, '2026-05-01 13:00:00+00', NOW(), NOW()),
    ('55550002-0000-0000-0000-000000000004', 'tev', 'd0000002-0000-0000-0000-000000000002',
     true, false, '2026-05-01 13:00:00+00', NULL, '2026-05-01 13:00:00+00', NOW(), NOW());

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts, global_id,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    -- V root — erin only (dave wasn't on the thread yet)
    ('66660002-0000-0000-0000-000000000005', '55550002-0000-0000-0000-000000000004',
     'd0000002-0000-0000-0000-000000000002', 'me5', 'c1000002-0000-0000-0000-000000000002',
     'Conv V', 'v root (erin only)', '2026-05-01 12:30:00+00', '<v-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    -- V reply — both copies (dave added here)
    ('66660001-0000-0000-0000-000000000006', '55550001-0000-0000-0000-000000000004',
     'd0000001-0000-0000-0000-000000000001', 'md6', 'c1000001-0000-0000-0000-000000000001',
     'Conv V', 'v reply (dave copy)', '2026-05-01 13:00:00+00', '<v-2@acme.com>',
     false, false, false, false, NOW(), NOW()),
    ('66660002-0000-0000-0000-000000000006', '55550002-0000-0000-0000-000000000004',
     'd0000002-0000-0000-0000-000000000002', 'me6', 'c1000002-0000-0000-0000-000000000002',
     'Conv V', 'v reply (erin copy)', '2026-05-01 13:00:00+00', '<v-2@acme.com>',
     false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('66660002-0000-0000-0000-000000000005', '77770002-0000-0000-0000-000000000001'),
    ('66660001-0000-0000-0000-000000000006', '77770001-0000-0000-0000-000000000001'),
    ('66660002-0000-0000-0000-000000000006', '77770002-0000-0000-0000-000000000001');
