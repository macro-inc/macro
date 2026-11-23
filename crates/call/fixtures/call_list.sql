-- Fixture for the call list tests (pg_call_repo/call_list/test.rs).
--
-- The viewer is in team T and channel MEMBER, and has left channel LEFT.
--
-- Visible to the viewer (last activity order):
--   A2  archived in OTHER, shared to team T, discussed in a channel thread
--   L1  live in MEMBER, the viewer missed it (a guest is on it)
--   A1  archived in MEMBER, the viewer attended (two guests joined together)
--   I1  imported, the viewer's own (three attendees, no start time)
--   S2  archived standalone, granted to the viewer
--   U1  archived in OTHER, reached only through the viewer's own grant
--   T2  imported by the viewer, started and ended with T1 (ties sort by id);
--       imported after U1 started, so sorting imports by import time would
--       move it above U1
--   T1  archived standalone, the viewer's own
-- Not visible:
--   S1  archived standalone, owned by another user, granted to team T and
--       channel MEMBER
--   I2  imported standalone, owned by another user, granted to team T
--   X1  archived in OTHER, granted to its owner and to channel OTHER, which
--       the viewer is not in
--   A3  archived in LEFT, granted to that channel only
--   W1  archived in OTHER, the viewer's grant is on a document with its id
--   W2  archived standalone, a team-typed grant carries the viewer's id

INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'macro|viewer@example.com', 'viewer@example.com', 'cus_viewer'),
  ('00000000-0000-0000-0000-0000000000f2', 'macro|other@example.com', 'other@example.com', 'cus_other');

INSERT INTO "User" (id, email, macro_user_id) VALUES
  ('macro|viewer@example.com', 'viewer@example.com', '00000000-0000-0000-0000-0000000000f1'),
  ('macro|other@example.com', 'other@example.com', '00000000-0000-0000-0000-0000000000f2');

INSERT INTO team (id, name, owner_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'team t', 'macro|other@example.com');

INSERT INTO team_user (user_id, team_id, team_role) VALUES
  ('macro|viewer@example.com', '00000000-0000-0000-0000-0000000000a1', 'member');

INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'member', 'public', NULL, 'macro|other@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'other', 'public', NULL, 'macro|other@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'left', 'public', NULL, 'macro|other@example.com');

INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at, left_at) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'macro|viewer@example.com', 'member', '2026-01-01 00:00:00+00', NULL),
  ('00000000-0000-0000-0000-0000000000c1', 'macro|other@example.com', 'owner', '2026-01-01 00:00:00+00', NULL),
  ('00000000-0000-0000-0000-0000000000c2', 'macro|other@example.com', 'owner', '2026-01-01 00:00:00+00', NULL),
  ('00000000-0000-0000-0000-0000000000c3', 'macro|viewer@example.com', 'member', '2026-01-01 00:00:00+00', '2026-01-01 01:00:00+00');

INSERT INTO "SharePermission" (id) VALUES
  ('sp-a1'), ('sp-l1'), ('sp-a2'), ('sp-s1'), ('sp-s2'), ('sp-i1'), ('sp-i2'), ('sp-x1'), ('sp-a3'),
  ('sp-u1'), ('sp-w1'), ('sp-w2'), ('sp-t1'), ('sp-t2');

INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, share_permission_id) VALUES
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000c1', 'room-a1', 'macro|other@example.com',
   '2026-01-01 10:00:00+00', '2026-01-01 10:30:00+00', 1800000, 'sp-a1'),
  ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-0000000000c2', 'room-a2', 'macro|other@example.com',
   '2026-01-01 09:00:00+00', '2026-01-01 12:00:00+00', 10800000, 'sp-a2'),
  ('00000000-0000-0000-0000-00000000ca04', NULL, 'room-s1', 'macro|other@example.com',
   '2026-01-01 07:00:00+00', '2026-01-01 07:10:00+00', 600000, 'sp-s1'),
  ('00000000-0000-0000-0000-00000000ca05', NULL, 'room-s2', 'macro|other@example.com',
   '2026-01-01 08:00:00+00', '2026-01-01 08:10:00+00', 600000, 'sp-s2'),
  ('00000000-0000-0000-0000-00000000ca08', '00000000-0000-0000-0000-0000000000c2', 'room-x1', 'macro|other@example.com',
   '2026-01-01 13:00:00+00', '2026-01-01 13:10:00+00', 600000, 'sp-x1'),
  ('00000000-0000-0000-0000-00000000ca09', '00000000-0000-0000-0000-0000000000c3', 'room-a3', 'macro|other@example.com',
   '2026-01-01 14:00:00+00', '2026-01-01 14:10:00+00', 600000, 'sp-a3'),
  ('00000000-0000-0000-0000-00000000ca0a', '00000000-0000-0000-0000-0000000000c2', 'room-u1', 'macro|other@example.com',
   '2026-01-01 07:30:00+00', '2026-01-01 07:45:00+00', 900000, 'sp-u1'),
  ('00000000-0000-0000-0000-00000000ca0b', '00000000-0000-0000-0000-0000000000c2', 'room-w1', 'macro|other@example.com',
   '2026-01-01 13:30:00+00', '2026-01-01 13:40:00+00', 600000, 'sp-w1'),
  ('00000000-0000-0000-0000-00000000ca0c', NULL, 'room-w2', 'macro|other@example.com',
   '2026-01-01 14:30:00+00', '2026-01-01 14:40:00+00', 600000, 'sp-w2'),
  ('00000000-0000-0000-0000-00000000ca0d', NULL, 'room-t1', 'macro|viewer@example.com',
   '2026-01-01 06:00:00+00', '2026-01-01 06:10:00+00', 600000, 'sp-t1');

INSERT INTO calls (id, channel_id, room_name, created_by, created_at, share_permission_id) VALUES
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-0000000000c1', 'room-l1', 'macro|other@example.com',
   '2026-01-01 11:00:00+00', 'sp-l1');

-- The native mirrors come from triggers; A2 was discussed in its channel.
UPDATE call_entities SET discussion = 'channel_thread'
WHERE id = '00000000-0000-0000-0000-00000000ca03';

INSERT INTO call_entities (id, user_id, title, created_via, started_at, ended_at, duration_ms, channel_id, share_permission_id, created_at) VALUES
  ('00000000-0000-0000-0000-00000000ca06', 'macro|viewer@example.com', 'Imported review', 'import',
   NULL, NULL, NULL, NULL, 'sp-i1', '2026-01-01 09:30:00+00'),
  ('00000000-0000-0000-0000-00000000ca07', 'macro|other@example.com', 'Imported other', 'import',
   '2026-01-01 15:00:00+00', '2026-01-01 15:30:00+00', 1800000, NULL, 'sp-i2', '2026-01-01 15:00:00+00'),
  ('00000000-0000-0000-0000-00000000ca0e', 'macro|viewer@example.com', 'Imported tie', 'import',
   '2026-01-01 06:00:00+00', '2026-01-01 06:10:00+00', 600000, NULL, 'sp-t2', '2026-01-01 07:50:00+00');

INSERT INTO call_record_participants (call_record_id, user_id, joined_at, left_at) VALUES
  ('00000000-0000-0000-0000-00000000ca01', 'macro|viewer@example.com', '2026-01-01 10:01:00+00', '2026-01-01 10:20:00+00'),
  ('00000000-0000-0000-0000-00000000ca01', 'macro|other@example.com', '2026-01-01 10:00:00+00', '2026-01-01 10:30:00+00');

INSERT INTO call_record_guests (call_record_id, id, display_name, joined_at, left_at) VALUES
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000b2', 'Guest Two',
   '2026-01-01 10:05:00+00', '2026-01-01 10:25:00+00'),
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000b1', 'Guest One',
   '2026-01-01 10:05:00+00', '2026-01-01 10:15:00+00');

INSERT INTO call_participants (call_id, user_id, joined_at) VALUES
  ('00000000-0000-0000-0000-00000000ca02', 'macro|other@example.com', '2026-01-01 11:00:00+00');

INSERT INTO call_guests (id, call_id, display_name, joined_at) VALUES
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000ca02', 'Live Guest',
   '2026-01-01 11:02:00+00');

INSERT INTO call_entity_participants (call_id, id, display_name, email) VALUES
  ('00000000-0000-0000-0000-00000000ca06', '00000000-0000-0000-0000-0000000000e3', 'Ada', 'ada@example.com'),
  ('00000000-0000-0000-0000-00000000ca06', '00000000-0000-0000-0000-0000000000e1', NULL, 'grace@example.com'),
  ('00000000-0000-0000-0000-00000000ca06', '00000000-0000-0000-0000-0000000000e2', NULL, NULL);

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
  ('00000000-0000-0000-0000-00000000ca01', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca01', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
  ('00000000-0000-0000-0000-00000000ca02', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
  ('00000000-0000-0000-0000-00000000ca03', 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'),
  ('00000000-0000-0000-0000-00000000ca03', 'call', '00000000-0000-0000-0000-0000000000c2', 'channel', 'view'),
  ('00000000-0000-0000-0000-00000000ca04', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca04', 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'),
  ('00000000-0000-0000-0000-00000000ca04', 'call', '00000000-0000-0000-0000-0000000000c1', 'channel', 'view'),
  ('00000000-0000-0000-0000-00000000ca05', 'call', 'macro|viewer@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca06', 'call', 'macro|viewer@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca07', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca07', 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'),
  ('00000000-0000-0000-0000-00000000ca08', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca08', 'call', '00000000-0000-0000-0000-0000000000c2', 'channel', 'view'),
  ('00000000-0000-0000-0000-00000000ca09', 'call', '00000000-0000-0000-0000-0000000000c3', 'channel', 'view'),
  ('00000000-0000-0000-0000-00000000ca0a', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca0a', 'call', 'macro|viewer@example.com', 'user', 'view'),
  ('00000000-0000-0000-0000-00000000ca0b', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca0b', 'document', 'macro|viewer@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca0c', 'call', 'macro|other@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca0c', 'call', 'macro|viewer@example.com', 'team', 'view'),
  ('00000000-0000-0000-0000-00000000ca0d', 'call', 'macro|viewer@example.com', 'user', 'owner'),
  ('00000000-0000-0000-0000-00000000ca0e', 'call', 'macro|viewer@example.com', 'user', 'owner');
