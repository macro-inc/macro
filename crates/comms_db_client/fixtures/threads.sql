INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'private-channel', 'private', NULL, 'macro|owner1@test.com'),
       ('22222222-2222-2222-2222-222222222222', 'private-channel', 'private', NULL, 'macro|owner1@test.com');

INSERT INTO comms_channel_participants (channel_id, role, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'owner', 'macro|user1@test.com'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'macro|user2@test.com'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'macro|user3@test.com'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'macro|user4@test.com'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'macro|user5@test.com'),
       ('22222222-2222-2222-2222-222222222222', 'owner', 'macro|user5@test.com'),
       ('22222222-2222-2222-2222-222222222222', 'member', 'macro|user6@test.com');

INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content) VALUES
('11111111-1111-1111-1111-111111111111', 'channel', '11111111-1111-1111-1111-111111111111',
        NULL, 'macro|user1@test.com', 'Test message 1');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content) VALUES
('22222222-2222-2222-2222-222222222222', 'channel', '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111', 'macro|user2@test.com', 'Test message 1');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content) VALUES
('33333333-3333-3333-3333-333333333333', 'channel', '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111', 'macro|user3@test.com', 'Test message 1');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content) VALUES
('44444444-4444-4444-4444-444444444444', 'channel', '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111', 'macro|user4@test.com', 'Test message 1');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content) VALUES
('66666666-6666-6666-6666-666666666666', 'channel', '22222222-2222-2222-2222-222222222222', 'macro|user5@test.com', 'Other thread');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content) VALUES
('55555555-5555-5555-5555-555555555555', 'channel', '22222222-2222-2222-2222-222222222222',
        '66666666-6666-6666-6666-666666666666', 'macro|user5@test.com', 'Test message 1');

INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'message', '22222222-2222-2222-2222-222222222222',
        'user', 'macro|user5@test.com'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'message', '33333333-3333-3333-3333-333333333333',
        'doc', 'doc-should-be-ignored'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'message', '55555555-5555-5555-5555-555555555555',
        'user', 'macro|user6@test.com'),
       ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'message', '33333333-3333-3333-3333-333333333333',
        'user', 'macro|outsider@test.com');
