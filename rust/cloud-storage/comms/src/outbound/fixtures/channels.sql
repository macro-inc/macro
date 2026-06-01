-- Channels for dynamic query tests
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Private Channel A', 'private', NULL, 'macro|user-1@test.com', '2024-01-01 10:00:00', '2024-01-10 10:00:00'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Private Channel B', 'private', NULL, 'macro|user-1@test.com', '2024-01-02 10:00:00', '2024-01-09 10:00:00'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Public Channel C', 'public', NULL, 'macro|user-2@test.com', '2024-01-03 10:00:00', '2024-01-08 10:00:00'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, 'direct_message', NULL, 'macro|user-1@test.com', '2024-01-04 10:00:00', '2024-01-07 10:00:00');

-- Participants
INSERT INTO comms_channel_participants (channel_id, role, user_id, joined_at)
VALUES
    -- user-1 is in channels A, B, and D
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'macro|user-1@test.com', '2024-01-01 10:00:00'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner', 'macro|user-1@test.com', '2024-01-02 10:00:00'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner', 'macro|user-1@test.com', '2024-01-04 10:00:00'),
    -- user-1 is also a member of channel C
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'member', 'macro|user-1@test.com', '2024-01-03 10:00:00'),
    -- user-2 owns channel C
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner', 'macro|user-2@test.com', '2024-01-03 10:00:00'),
    -- user-2 is a member of channel D (DM)
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'member', 'macro|user-2@test.com', '2024-01-04 10:00:00');

-- Notifications for channel notification filter tests
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
VALUES
    ('eeeeeeea-0000-0000-0000-000000000001', 'test', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel', 'test', '{}'::jsonb, 'macro|user-2@test.com'),
    ('eeeeeeeb-0000-0000-0000-000000000002', 'test', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'channel', 'test', '{}'::jsonb, 'macro|user-2@test.com');

INSERT INTO user_notification (user_id, notification_id, created_at, seen_at, done)
VALUES
    -- Channel A: not done + unread
    ('macro|user-1@test.com', 'eeeeeeea-0000-0000-0000-000000000001', '2024-01-05 10:00:00', NULL, false),
    -- Channel B: done + seen
    ('macro|user-1@test.com', 'eeeeeeeb-0000-0000-0000-000000000002', '2024-01-05 10:01:00', '2024-01-05 11:00:00', true);

-- Messages for latest message tests
INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content, created_at, updated_at, deleted_at)
VALUES
    -- Channel A messages: 2 non-thread, 2 thread messages
    ('aaaaaa2a-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'macro|user-1@test.com', 'First message in A', '2024-01-01 11:00:00', '2024-01-01 11:00:00', NULL),
    ('aaaaaa2a-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'macro|user-1@test.com', 'Second message in A (latest non-thread)', '2024-01-01 12:00:00', '2024-01-01 12:00:00', NULL),
    ('aaaaaa2a-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaa2a-0000-0000-0000-000000000001', 'macro|user-2@test.com', 'Thread reply in A', '2024-01-01 13:00:00', '2024-01-01 13:00:00', NULL),
    ('aaaaaa2a-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaa2a-0000-0000-0000-000000000001', 'macro|user-1@test.com', 'Latest thread reply in A (latest overall)', '2024-01-01 14:00:00', '2024-01-01 14:00:00', NULL),

    -- Channel B messages: all in a thread (no non-thread messages except the parent, which will be deleted)
    ('bbbbbb2b-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'macro|user-1@test.com', 'Deleted parent message', '2024-01-02 11:00:00', '2024-01-02 11:00:00', '2024-01-02 15:00:00'),
    ('bbbbbb2b-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbb2b-0000-0000-0000-000000000001', 'macro|user-2@test.com', 'Thread reply 1 in B', '2024-01-02 12:00:00', '2024-01-02 12:00:00', NULL),
    ('bbbbbb2b-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbb2b-0000-0000-0000-000000000001', 'macro|user-1@test.com', 'Latest thread reply in B (latest overall)', '2024-01-02 13:00:00', '2024-01-02 13:00:00', NULL),

    -- Channel C messages: single non-thread message
    ('cccccc2c-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'macro|user-2@test.com', 'First message in C', '2024-01-03 11:00:00', '2024-01-03 11:00:00', NULL),
    ('cccccc2c-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'macro|user-1@test.com', 'Latest message in C (both latest and latest non-thread)', '2024-01-03 12:00:00', '2024-01-03 12:00:00', NULL),

    -- Channel D messages: single message
    ('dddddd1d-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, 'macro|user-1@test.com', 'Single message in D (DM)', '2024-01-04 11:00:00', '2024-01-04 11:00:00', NULL);
