INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'private 1 ', 'private', NULL, 'user1'),
       ('22222222-2222-2222-2222-222222222222', NULL, 'direct_message', NULL, 'user3'),
       ('33333333-3333-3333-3333-333333333333', 'public channel', 'public', NULL, 'user5');

INSERT INTO comms_channel_participants (channel_id, role, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'owner', 'user1'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'user2'),
       ('11111111-1111-1111-1111-111111111111', 'member', 'user3'),
       ('22222222-2222-2222-2222-222222222222', 'owner', 'user3'),
       ('22222222-2222-2222-2222-222222222222', 'member', 'user4'),
       ('33333333-3333-3333-3333-333333333333', 'owner', 'user5'),
       ('33333333-3333-3333-3333-333333333333', 'member', 'user1'),
       ('33333333-3333-3333-3333-333333333333', 'member', 'user2'),
       ('33333333-3333-3333-3333-333333333333', 'member', 'user3'),
       ('33333333-3333-3333-3333-333333333333', 'member', 'user4'),
       ('33333333-3333-3333-3333-333333333333', 'member', 'user7');
-- User7 will later have left_at set to simulate leaving the channel
-- This is handled in integration test or a migration if requested again.

