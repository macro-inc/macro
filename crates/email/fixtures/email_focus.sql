-- Fixture for the Focus repository (email crate, outbound/focus_pg).
--
-- Link f01 is owner@acme.com; link f02 is other@elsewhere.com.
-- Thread f201: signal, in inbox. Casey wrote, the owner replied, Casey wrote
--   again, and a later message from Casey is in the trash.
-- Thread f202: signal but archived.
-- Thread f203: in inbox but not signal.
-- Thread f204: signal bulk mail (List-Unsubscribe) from seller@leads.io.
-- Thread f205: the owner's own "No thanks" to seller@leads.io.
-- Thread f206: signal, in inbox, but its mail is 60 days old.
-- Thread f207: signal, in inbox, on the other link.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01', 'macro|owner@acme.com', '00000000-0000-0000-0000-000000000f01',
        'Owner@Acme.com', 'GMAIL', true, NOW(), NOW()),
       ('00000000-0000-0000-0000-000000000f02', 'macro|other@elsewhere.com', '00000000-0000-0000-0000-000000000f02',
        'other@elsewhere.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cf001', '00000000-0000-0000-0000-000000000f01', 'Casey@Customer.com', 'Casey', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cf002', '00000000-0000-0000-0000-000000000f01', 'owner@acme.com', 'Owner', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cf003', '00000000-0000-0000-0000-000000000f01', 'jacob@acme.com', 'Jacob', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cf004', '00000000-0000-0000-0000-000000000f01', 'seller@leads.io', NULL, NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cf005', '00000000-0000-0000-0000-000000000f02', 'friend@example.com', NULL, NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, created_at)
VALUES ('00000000-0000-0000-0000-0000000bf001', '00000000-0000-0000-0000-000000000f01', 'TRASH', 'TRASH', NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, is_signal, latest_inbound_message_ts, latest_outbound_message_ts, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000f01', true, false, true,
        NOW() - INTERVAL '20 hours', NOW() - INTERVAL '1 day', NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f202', '00000000-0000-0000-0000-000000000f01', false, true, true,
        NULL, NULL, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f203', '00000000-0000-0000-0000-000000000f01', true, false, false,
        NOW() - INTERVAL '2 hours', NULL, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f204', '00000000-0000-0000-0000-000000000f01', true, false, true,
        NOW() - INTERVAL '3 days', NULL, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f205', '00000000-0000-0000-0000-000000000f01', false, true, true,
        NULL, NOW() - INTERVAL '4 days', NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f206', '00000000-0000-0000-0000-000000000f01', true, false, true,
        NOW() - INTERVAL '60 days', NULL, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f207', '00000000-0000-0000-0000-000000000f02', true, false, true,
        NOW() - INTERVAL '1 hour', NULL, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, from_name,
                            internal_date_ts, subject, body_text, headers_jsonb,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000f01',
        'p-f501', 'g-f501', false, '00000000-0000-0000-0000-0000000cf001', NULL,
        NOW() - INTERVAL '2 days', 'Unpaid invoice', 'Can you approve the invoice?', '[]'::jsonb,
        true, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f502', '00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000f01',
        'p-f502', 'g-f502', true, '00000000-0000-0000-0000-0000000cf002', 'Owner',
        NOW() - INTERVAL '1 day', 'Re: Unpaid invoice', 'Thanks, I will take a look today.', NULL,
        false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f503', '00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000f01',
        'p-f503', 'g-f503', false, '00000000-0000-0000-0000-0000000cf001', 'Casey C.',
        NOW() - INTERVAL '20 hours', 'Re: Unpaid invoice', 'Any update?', '[{"name": "Precedence", "value": "normal"}]'::jsonb,
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f504', '00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000f01',
        'p-f504', 'g-f504', false, '00000000-0000-0000-0000-0000000cf001', NULL,
        NOW() - INTERVAL '10 hours', 'Re: Unpaid invoice', 'Trashed follow-up', NULL,
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f505', '00000000-0000-0000-0000-00000000f204', '00000000-0000-0000-0000-000000000f01',
        'p-f505', 'g-f505', false, '00000000-0000-0000-0000-0000000cf004', 'Sam Seller',
        NOW() - INTERVAL '3 days', 'Quick question', 'Worth a chat?',
        '[{"name": "List-Unsubscribe", "value": "<mailto:u@leads.io>"}]'::jsonb,
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f506', '00000000-0000-0000-0000-00000000f205', '00000000-0000-0000-0000-000000000f01',
        'p-f506', 'g-f506', true, '00000000-0000-0000-0000-0000000cf002', 'Owner',
        NOW() - INTERVAL '4 days', 'Re: Earlier pitch', 'No thanks', NULL,
        false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f507', '00000000-0000-0000-0000-00000000f207', '00000000-0000-0000-0000-000000000f02',
        'p-f507', 'g-f507', false, '00000000-0000-0000-0000-0000000cf005', NULL,
        NOW() - INTERVAL '1 hour', 'Hi', 'Hello there', NULL,
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-0000000cf003', 'CC'),
       ('00000000-0000-0000-0000-00000000f502', '00000000-0000-0000-0000-0000000cf001', 'TO'),
       ('00000000-0000-0000-0000-00000000f503', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f505', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f506', '00000000-0000-0000-0000-0000000cf004', 'TO');

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-00000000f504', '00000000-0000-0000-0000-0000000bf001');
