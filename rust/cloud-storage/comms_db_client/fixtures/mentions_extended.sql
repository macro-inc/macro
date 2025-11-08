-- Channels for testing
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Public Channel', 'public', NULL, 'owner1'),
       ('22222222-2222-2222-2222-222222222222', 'Test Organization Channel', 'organization', 1001, 'owner2'),
       ('33333333-3333-3333-3333-333333333333', 'Test Private Channel', 'private', NULL, 'owner3'),
       ('44444444-4444-4444-4444-444444444444', 'Channel With Deleted Message', 'public', NULL, 'owner4'),
       ('55555555-5555-5555-5555-555555555555', 'Channel With Multiple Mentions', 'public', NULL, 'owner5');

-- Channel participants
INSERT INTO comms_channel_participants (channel_id, role, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'owner', 'user1'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'user2'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'user3'),
       ('22222222-2222-2222-2222-222222222222', 'owner', 'user3'),
       ('22222222-2222-2222-2222-222222222222', 'member', 'user4'),
       ('33333333-3333-3333-3333-333333333333', 'owner', 'user5'),
       ('44444444-4444-4444-4444-444444444444', 'owner', 'owner4'),
       ('55555555-5555-5555-5555-555555555555', 'owner', 'owner5');

-- Messages
INSERT INTO comms_messages (id, channel_id, sender_id, content, thread_id, deleted_at)
VALUES
    -- Message with mention in channel 1
    ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'user1', 'Test message 1', NULL,
     NULL),
    -- Regular message in channel 2 (no mentions)
    ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'user3', 'Regular message', NULL,
     NULL),
    -- Deleted message in channel 4
    ('44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'user1', 'Deleted message', NULL,
     NOW()),
    -- Multiple messages in channel 5
    ('55555555-5555-5555-5555-555555555551', '55555555-5555-5555-5555-555555555555', 'user1', 'Message 1', NULL, NULL),
    ('55555555-5555-5555-5555-555555555552', '55555555-5555-5555-5555-555555555555', 'user2', 'Message 2', NULL, NULL);

-- Entity mentions
INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, created_at)
VALUES
    -- Mention in channel 1
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'message', '11111111-1111-1111-1111-111111111111', 'user', 'user1',
     '2024-01-01 10:00:00'),
    -- Mention in deleted message (channel 4)
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'message', '44444444-4444-4444-4444-444444444444', 'user', 'user2',
     '2024-01-01 11:00:00'),
    -- Multiple mentions in channel 5
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'message', '55555555-5555-5555-5555-555555555551', 'user', 'user3',
     '2024-01-01 12:00:00'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'message', '55555555-5555-5555-5555-555555555552', 'doc', 'doc1',
     '2024-01-01 13:00:00');