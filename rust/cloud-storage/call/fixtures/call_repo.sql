-- Fixture for call repo integration tests.
--
-- Channel: ch1 (public)
-- Active call: call1 in ch1, created by user-a
-- Participants: user-a (creator), user-b
--
-- Channel: ch2 (public, no active call — tests opt in via create_call)

-- channels
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000c01', 'call-test-channel', 'public', NULL, 'macro|user-a@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-000000000c02', 'empty-channel', 'public', NULL, 'macro|user-b@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- channel members for ch1 (user-c is a member but never joins a call)
INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at) VALUES
  ('00000000-0000-0000-0000-000000000c01', 'macro|user-a@test.com', 'owner',  '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-000000000c01', 'macro|user-b@test.com', 'member', '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-000000000c01', 'macro|user-c@test.com', 'member', '2024-01-01 00:00:00+00');

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

-- share permission for the archived call
INSERT INTO "SharePermission" (id, "isPublic", "publicAccessLevel", "createdAt", "updatedAt") VALUES
  ('00000000-0000-0000-0000-00000000sp02', false, NULL, '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level) VALUES
  ('00000000-0000-0000-0000-00000000sp02', '00000000-0000-0000-0000-000000000c01', 'view');

-- archived call record in ch1 (id = CALL_ARCHIVED)
INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, egress_id, share_permission_id) VALUES
  ('00000000-0000-0000-0000-0000000ca2ed', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000c01', 'macro|user-a@test.com',
   '2024-01-01 10:00:00+00', '2024-01-01 10:05:00+00', 300000, 'egress-arch-1',
   '00000000-0000-0000-0000-00000000sp02');

INSERT INTO call_record_participants (call_record_id, user_id, joined_at, left_at) VALUES
  ('00000000-0000-0000-0000-0000000ca2ed', 'macro|user-a@test.com', '2024-01-01 10:00:00+00', '2024-01-01 10:05:00+00'),
  ('00000000-0000-0000-0000-0000000ca2ed', 'macro|user-b@test.com', '2024-01-01 10:01:00+00', '2024-01-01 10:04:30+00');

INSERT INTO call_record_transcripts (call_record_id, segment_id, speaker_id, diarized_speaker_id, custom_speaker, content, started_at, ended_at, sequence_num) VALUES
  ('00000000-0000-0000-0000-0000000ca2ed', 'seg-arch-1', 'macro|user-a@test.com', 'spk-arch-a0', NULL,                    'archived hello',
   '2024-01-01 10:00:05+00', '2024-01-01 10:00:07+00', 1),
  ('00000000-0000-0000-0000-0000000ca2ed', 'seg-arch-2', 'macro|user-b@test.com', NULL,          NULL,                    'archived reply',
   '2024-01-01 10:00:08+00', '2024-01-01 10:00:10+00', 2),
  -- Override row: derived speaker_id is user-a, but custom_speaker pins it to user-b.
  ('00000000-0000-0000-0000-0000000ca2ed', 'seg-arch-3', 'macro|user-a@test.com', 'spk-arch-b0', 'macro|user-b@test.com', 'archived overridden',
   '2024-01-01 10:00:11+00', '2024-01-01 10:00:13+00', 3);

-- entity_access grants for the active call (owner + channel view).
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
  ('00000000-0000-0000-0000-0000000ca110', 'call', 'macro|user-a@test.com', 'user',    'owner'),
  ('00000000-0000-0000-0000-0000000ca110', 'call', '00000000-0000-0000-0000-000000000c01', 'channel', 'view');

-- entity_access grants for the archived call (owner + channel view).
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
  ('00000000-0000-0000-0000-0000000ca2ed', 'call', 'macro|user-a@test.com', 'user',    'owner'),
  ('00000000-0000-0000-0000-0000000ca2ed', 'call', '00000000-0000-0000-0000-000000000c01', 'channel', 'view');
