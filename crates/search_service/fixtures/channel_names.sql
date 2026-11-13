-- The viewer is in 100 channels whose names hold "launch", all updated after
-- the one channel named exactly "Launch", so a name read of "launch" fills
-- its 100 rows without it.
INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
SELECT
  ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'launch notes ' || n,
  'public',
  'macro|viewer@example.com',
  '2024-01-01 00:00:00+00',
  '2024-02-01 00:00:00+00'::timestamptz + n * interval '1 minute'
FROM generate_series(1, 100) AS n;

INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000e0e0', 'Launch', 'public', 'macro|viewer@example.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- Likewise 100 newer channels whose names hold "alice" and "bob", and an
-- older unnamed private channel with alice and bob, which the viewer sees as
-- "alice, bob".
INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
SELECT
  ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid,
  'alice and bob notes ' || n,
  'public',
  'macro|viewer@example.com',
  '2024-01-01 00:00:00+00',
  '2024-02-01 00:00:00+00'::timestamptz + n * interval '1 minute'
FROM generate_series(1, 100) AS n;

INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000a1b0', NULL, 'private', 'macro|viewer@example.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
SELECT id, 'macro|viewer@example.com', 'owner', '2024-01-01 00:00:00+00'
FROM comms_channels;

INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at) VALUES
  ('00000000-0000-0000-0000-00000000a1b0', 'macro|alice@example.com', 'member', '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-00000000a1b0', 'macro|bob@example.com', 'member', '2024-01-01 00:00:00+00');
