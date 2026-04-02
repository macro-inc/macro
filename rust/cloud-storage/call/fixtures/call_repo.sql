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

-- active call in ch1
INSERT INTO calls (id, channel_id, room_name, created_by, created_at) VALUES
  ('00000000-0000-0000-0000-0000000ca110', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000c01', 'macro|user-a@test.com',
   '2024-01-01 12:00:00+00');

-- participants in call1
INSERT INTO call_participants (call_id, user_id, joined_at) VALUES
  ('00000000-0000-0000-0000-0000000ca110', 'macro|user-a@test.com', '2024-01-01 12:00:00+00'),
  ('00000000-0000-0000-0000-0000000ca110', 'macro|user-b@test.com', '2024-01-01 12:01:00+00');
