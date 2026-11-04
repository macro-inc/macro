-- Label deletions in the settings queue, layered on email_labels.sql's Gmail link.
-- MyCustomLabel (thread 5) was deleted again after an earlier delete finished, so it is hidden.
-- IMPORTANT (thread 1) has only a finished delete, so it is shown.
-- SENT (thread 2) has unfinished work of another kind on this link and a delete
-- queued on another link, so it is shown.

-- The user label view sorts threads by their labeled messages' dates.
UPDATE email_messages SET internal_date_ts = created_at WHERE link_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 'macro2', 'user2', 'user2@test.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_mailbox_settings_work (id, link_id, kind, resource_key, revision, completed_revision)
VALUES
    ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delete_label', 'Label_123', 2, 1),
    ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delete_label', 'IMPORTANT', 1, 1),
    ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'create_label', 'SENT', 1, 0),
    ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 'delete_label', 'SENT', 1, 0);
