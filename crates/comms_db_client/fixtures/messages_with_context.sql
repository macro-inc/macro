-- Fixture for testing get_messages_with_context
-- Creates a channel with 10 messages in chronological order

INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'test channel', 'public', 'macro|user1@test.com', '2024-01-01T10:00:00Z');

INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at)
VALUES
    -- 10 messages in chronological order in the same channel
    ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user1@test.com', 'Message 1',
     '2024-01-01T10:00:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user2@test.com', 'Message 2',
     '2024-01-01T10:01:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user3@test.com', 'Message 3',
     '2024-01-01T10:02:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user4@test.com', 'Message 4',
     '2024-01-01T10:03:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user5@test.com', 'Message 5',
     '2024-01-01T10:04:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user1@test.com', 'Message 6',
     '2024-01-01T10:05:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user2@test.com', 'Message 7',
     '2024-01-01T10:06:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user3@test.com', 'Message 8',
     '2024-01-01T10:07:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user4@test.com', 'Message 9',
     '2024-01-01T10:08:00Z'),
    ('bbbbbbbb-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', 'macro|user5@test.com', 'Message 10',
     '2024-01-01T10:09:00Z');
