-- One inbox with a synced address book of five contacts (one automated) and
-- sent mail that ranks two of them: carol three messages, alice one.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('ab000000-0000-0000-0000-000000000001', 'macro|owner@acme.com', 'fa-owner', 'owner@acme.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('ac000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', 'Alice@Acme.com', 'Alice', NOW(), NOW()),
    ('ac000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000001', 'bob@acme.com', 'Bob', NOW(), NOW()),
    ('ac000000-0000-0000-0000-000000000003', 'ab000000-0000-0000-0000-000000000001', 'carol@gmail.com', 'Carol', NOW(), NOW()),
    ('ac000000-0000-0000-0000-000000000004', 'ab000000-0000-0000-0000-000000000001', 'noreply@acme.com', NULL, NOW(), NOW()),
    ('ac000000-0000-0000-0000-000000000005', 'ab000000-0000-0000-0000-000000000001', 'dave@example.org', 'Dave', NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', true, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES
    ('ae000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001',
     'provider-ab-1', TRUE, '2026-01-05 10:00:00 +00:00', false, true, false, false, NOW(), NOW()),
    ('ae000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001',
     'provider-ab-2', TRUE, '2026-01-05 11:00:00 +00:00', false, true, false, false, NOW(), NOW()),
    ('ae000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001',
     'provider-ab-3', TRUE, '2026-01-05 12:00:00 +00:00', false, true, false, false, NOW(), NOW()),
    -- A draft never counts toward the ranking.
    ('ae000000-0000-0000-0000-000000000004', 'ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001',
     'provider-ab-4', FALSE, '2026-01-05 13:00:00 +00:00', false, true, false, true, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    ('ae000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000003', 'TO'),
    ('ae000000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000003', 'TO'),
    ('ae000000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000003', 'CC'),
    ('ae000000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000001', 'TO'),
    ('ae000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000004', 'TO'),
    ('ae000000-0000-0000-0000-000000000004', 'ac000000-0000-0000-0000-000000000005', 'TO');
