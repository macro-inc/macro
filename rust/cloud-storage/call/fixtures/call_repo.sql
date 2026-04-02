-- Fixture for call repo integration tests.
--
-- Channel: ch1 (public)
-- Active call: call1 in ch1, created by user-a
-- Participants: user-a (creator), user-b
--
-- Channel: ch2 (public, no active call)

-- channels
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000c01', 'call-test-channel', 'public', NULL, 'macro|user-a@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-000000000c02', 'empty-channel', 'public', NULL, 'macro|user-b@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- share permission for call1
INSERT INTO "SharePermission" (id, "isPublic", "publicAccessLevel", "createdAt", "updatedAt") VALUES
  ('00000000-0000-0000-0000-00000000sp01', false, NULL, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level) VALUES
  ('00000000-0000-0000-0000-00000000sp01', '00000000-0000-0000-0000-000000000c01', 'view');

-- active call in ch1
INSERT INTO calls (id, channel_id, room_name, created_by, created_at, share_permission_id) VALUES
  ('00000000-0000-0000-0000-0000000ca110', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000c01', 'macro|user-a@test.com',
   '2024-01-01 12:00:00+00', '00000000-0000-0000-0000-00000000sp01');

-- participants in call1
INSERT INTO call_participants (call_id, user_id, joined_at) VALUES
  ('00000000-0000-0000-0000-0000000ca110', 'macro|user-a@test.com', '2024-01-01 12:00:00+00'),
  ('00000000-0000-0000-0000-0000000ca110', 'macro|user-b@test.com', '2024-01-01 12:01:00+00');
