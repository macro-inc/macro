-- Received-message history is independent of the current INBOX label/timestamp.
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES
    ('c0000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user1@test.com', NOW(), NOW()),
    ('c0000002-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other@test.com', NOW(), NOW());

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('44444444-4444-4444-4444-444444444444', 'sent-only', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, true, NOW(), NOW()),
    ('55555555-5555-5555-5555-555555555555', 'self-addressed-draft', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, true, NOW(), NOW()),
    ('66666666-6666-6666-6666-666666666666', 'self-addressed-mail', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, from_contact_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES
    ('44444444-aaaa-aaaa-aaaa-444444444444', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sent-only-message', 'c0000001-0000-0000-0000-000000000001', true, false, true, false, false, '2025-01-01T10:00:00Z', NOW(), NOW()),
    ('55555555-aaaa-aaaa-aaaa-555555555555', '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'c0000001-0000-0000-0000-000000000001', true, false, false, true, false, '2025-01-01T10:00:00Z', NOW(), NOW()),
    ('66666666-aaaa-aaaa-aaaa-666666666666', '66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'self-addressed-message', 'c0000001-0000-0000-0000-000000000001', true, false, true, false, false, '2025-01-01T10:00:00Z', NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    ('44444444-aaaa-aaaa-aaaa-444444444444', 'c0000002-0000-0000-0000-000000000002', 'TO'),
    ('55555555-aaaa-aaaa-aaaa-555555555555', 'c0000001-0000-0000-0000-000000000001', 'TO'),
    ('66666666-aaaa-aaaa-aaaa-666666666666', 'c0000001-0000-0000-0000-000000000001', 'BCC');
