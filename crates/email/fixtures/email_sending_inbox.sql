-- Fixture for resolving which inbox a composed email is sent from.
--
-- One user with two of their own inboxes, each holding a received message, so
-- a reply can be checked against the inbox that actually received it rather
-- than the one that happens to come back first. `is_primary` is a generated
-- column (macro_id = 'macro|' || lower(email_address)), so user1@test.com is
-- the primary inbox and user1-alt@test.com is not.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'macro|user1@test.com', 'fa-user-1', 'user1@test.com', 'GMAIL', true, NOW() - INTERVAL '2 hours', NOW()),
    ('a2222222-2222-2222-2222-222222222222', 'macro|user1@test.com', 'fa-user-1', 'user1-alt@test.com', 'GMAIL', true, NOW() - INTERVAL '1 hour', NOW());

INSERT INTO email_contacts (id, link_id, email_address, name, sfs_photo_url, created_at, updated_at)
VALUES
    ('c1111111-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'alice@example.com', 'Alice Smith', NULL, NOW(), NOW()),
    ('c2222222-0000-0000-0000-000000000002', 'a2222222-2222-2222-2222-222222222222', 'alice@example.com', 'Alice Smith', NULL, NOW(), NOW());

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES
    ('d1111111-0000-0000-0000-000000000001', 'provider-thread-primary', 'a1111111-1111-1111-1111-111111111111', true, false, NOW(), NOW()),
    ('d2222222-0000-0000-0000-000000000002', 'provider-thread-alt', 'a2222222-2222-2222-2222-222222222222', true, false, NOW(), NOW());

-- One received message in each inbox.
INSERT INTO email_messages (id, provider_id, thread_id, provider_thread_id, link_id, from_contact_id, subject, is_read, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
VALUES
    ('e1111111-0000-0000-0000-000000000001', 'provider-msg-primary', 'd1111111-0000-0000-0000-000000000001', 'provider-thread-primary', 'a1111111-1111-1111-1111-111111111111',
     'c1111111-0000-0000-0000-000000000001', 'Hello primary', true, false, false, false, '2025-01-10 10:00:00+00', '2025-01-10 10:00:00+00', '2025-01-10 10:00:00+00'),
    ('e2222222-0000-0000-0000-000000000002', 'provider-msg-alt', 'd2222222-0000-0000-0000-000000000002', 'provider-thread-alt', 'a2222222-2222-2222-2222-222222222222',
     'c2222222-0000-0000-0000-000000000002', 'Hello alt', true, false, false, false, '2025-01-11 10:00:00+00', '2025-01-11 10:00:00+00', '2025-01-11 10:00:00+00');
