-- Message and (if any) thread test fixture
INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, thread_id, deleted_at)
VALUES
    -- Existing messages
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'user1', 'message 1 content',
     '2024-01-01T12:00:00Z', NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'user2', 'message 2 content',
     '2024-01-02T12:00:00Z', NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'user3', 'dm msg content',
     '2024-01-03T12:00:00Z', NULL, NULL),
    -- New messages
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'user1',
     'Check out this documentation!', '2024-01-04T10:00:00Z', NULL),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333', 'user2',
     'I found another version of that doc', '2024-01-04T11:00:00Z', NULL),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444', 'user5',
     'Here are multiple docs to review', '2024-01-05T09:00:00Z', NULL),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'user2',
     'Internal documentation draft', '2024-01-06T14:00:00Z', NULL),
    ('gggggggg-gggg-gggg-gggg-gggggggggggg', '66666666-6666-6666-6666-666666666666', 'user5',
     'Your private document for review', '2024-01-07T15:30:00Z', NULL),
    ('hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh', '33333333-3333-3333-3333-333333333333', 'user3',
     'Starting a thread about this doc', '2024-01-08T08:00:00Z', NULL),
    ('iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii', '33333333-3333-3333-3333-333333333333', 'user4',
     'Here are my thoughts on the doc', '2024-01-08T08:30:00Z', 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh'),
    ('jjjjjjjj-jjjj-jjjj-jjjj-jjjjjjjjjjjj', '33333333-3333-3333-3333-333333333333', 'user5',
     'I revised the doc with your feedback', '2024-01-08T10:00:00Z', 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh'),
    -- User with left channel but has messages
    ('kkkkkkkk-kkkk-kkkk-kkkk-kkkkkkkkkkkk', '11111111-1111-1111-1111-111111111111', 'user6',
     'This is from a user who left the channel', '2024-01-09T09:00:00Z', NULL),
    -- Deleted message (should not be returned in references)
    ('llllllll-llll-llll-llll-llllllllllll', '33333333-3333-3333-3333-333333333333', 'user1',
     'This message was deleted but had attachments', '2024-01-10T10:00:00Z', NULL, '2024-01-10T11:00:00Z'),
    -- For special attachment cases
    ('delmsg-del1-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'user2', 'This is a deleted message',
     '2024-06-12T12:00:00Z', NULL, '2024-06-12T13:00:00Z'),
    ('threadmsg-0001-0000-0000-0000000001', '33333333-3333-3333-3333-333333333333', 'user3', 'This is a thread reply',
     '2024-06-12T14:00:00Z', 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh', NULL),
    ('leftusermsg-0001-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'user7',
     'This is by a user who left', '2024-06-12T15:00:00Z', NULL, NULL);
