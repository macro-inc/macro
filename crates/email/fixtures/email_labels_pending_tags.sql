-- Pending category intents layered on email_labels.sql.
-- Thread 1 message: IMPORTANT is observed and pending, MyCustomLabel is only pending.
-- Thread 2 message: SENT is observed but pending removal.

-- Only Outlook links record pending category intents.
UPDATE email_links SET provider = 'OUTLOOK' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- The user label view sorts threads by their labeled messages' dates.
UPDATE email_messages SET internal_date_ts = created_at WHERE link_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO email_mailbox_commands (id, link_id, generation, actor_id, intent, status)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'macro|user1@test.com', '{}'::jsonb, 'pending');

INSERT INTO email_pending_mailbox_state (message_id, attribute, command_id, desired)
VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111', 'tag:IMPORTANT', 'cccccccc-0000-0000-0000-000000000001', 'true'::jsonb),
    ('11111111-aaaa-aaaa-aaaa-111111111111', 'tag:Label_123', 'cccccccc-0000-0000-0000-000000000001', 'true'::jsonb),
    ('11111111-aaaa-aaaa-aaaa-111111111111', 'read', 'cccccccc-0000-0000-0000-000000000001', 'true'::jsonb),
    ('22222222-aaaa-aaaa-aaaa-222222222222', 'tag:SENT', 'cccccccc-0000-0000-0000-000000000001', 'false'::jsonb);
