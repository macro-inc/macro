INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha', 'private', NULL, 'owner1', NOW(), NOW()),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta', 'private', NULL, 'owner2', NOW(), NOW()),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma', 'private', NULL, 'owner3', NOW(), NOW()),
       ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'delta', 'private', NULL, 'owner4', NOW(), NOW());

INSERT INTO comms_channel_participants (channel_id, role, user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'owner1'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner', 'owner2'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner', 'owner3'),
       ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner', 'owner4');

INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, thread_id, deleted_at)
VALUES ('aaaaaa1a-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'u1', 'A: first non-thread',
        '2024-01-01T10:00:00Z', NULL, NULL),
       ('aaaaaa2a-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'u1', 'A: thread root',
        '2024-01-02T10:00:00Z', NULL, NULL),
       ('aaaaaa1a-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'u2', 'A: reply 1',
        '2024-01-03T10:00:00Z', 'aaaaaa2a-0000-0000-0000-000000000002', NULL),
       ('aaaaaa2a-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'u3', 'A: reply 2 (latest)',
        '2024-01-04T10:00:00Z', 'aaaaaa2a-0000-0000-0000-000000000002', NULL);

INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, thread_id, deleted_at)
VALUES ('bbbbbbde-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u1', 'B: deleted root',
        '2024-02-01T09:00:00Z', NULL, '2024-02-01T10:00:00Z'),
       ('bbbbbb1b-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u2', 'B: reply 1',
        '2024-02-02T09:00:00Z', 'bbbbbbde-0000-0000-0000-000000000001', NULL),
       ('bbbbbb2b-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u3', 'B: reply 2',
        '2024-02-03T09:00:00Z', 'bbbbbbde-0000-0000-0000-000000000001', NULL);

INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, thread_id, deleted_at)
VALUES ('cccccc1c-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'u1', 'C: non-thread 1',
        '2024-03-01T08:00:00Z', NULL, NULL),
       ('cccccc2c-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'u2', 'C: non-thread 2',
        '2024-03-02T08:00:00Z', NULL, NULL);

INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, thread_id, deleted_at)
VALUES ('dddddd1d-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'u1', 'D: visible',
        '2024-04-01T12:00:00Z', NULL, NULL),
       ('ddddddde-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'u2', 'D: deleted newer',
        '2024-04-02T12:00:00Z', NULL, '2024-04-02T13:00:00Z');
