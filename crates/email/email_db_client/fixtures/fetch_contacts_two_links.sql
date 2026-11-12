-- Two inboxes (links) owned by the same fusionauth user, each with one
-- sent-to contact. Used to verify the multi-inbox /email/contacts union groups
-- contacts by link id.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('d1000000-0000-0000-0000-000000000001', 'macro|multi@test.com', 'fa-multi', 'multi@test.com', 'GMAIL', true, NOW() - INTERVAL '1 hour', NOW()),
    ('d2000000-0000-0000-0000-000000000002', 'macro|multi@test.com', 'fa-multi', 'multi.work@test.com', 'GMAIL', true, NOW(), NOW());

-- One recipient contact per link
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('dc000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice', NOW(), NOW()),
    ('dc000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'bob@example.com', 'Bob', NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', true, true, NOW(), NOW()),
    ('d3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', true, true, NOW(), NOW());

-- A sent message per link, addressed to that link's contact
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES
    ('d4000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
     'provider-msg-d1', TRUE, '2026-01-05 10:00:00 +00:00', false, true, false, false, NOW(), NOW()),
    ('d4000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002',
     'provider-msg-d2', TRUE, '2026-01-05 11:00:00 +00:00', false, true, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    ('d4000000-0000-0000-0000-000000000001', 'dc000000-0000-0000-0000-000000000001', 'TO'),
    ('d4000000-0000-0000-0000-000000000002', 'dc000000-0000-0000-0000-000000000002', 'TO');
