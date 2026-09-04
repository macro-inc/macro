-- Give user-a's channels different created_at, updated_at, and viewed_at
-- orderings so the channel-list cursor regression test exercises every simple
-- sort method. In particular, viewed_at reverses the updated_at ordering.
UPDATE comms_channels
SET created_at = '2024-01-01 00:00:00+00',
    updated_at = '2024-01-03 00:00:00+00'
WHERE id = '00000000-0000-0000-0000-000000000c01';

UPDATE comms_channels
SET created_at = '2024-01-02 00:00:00+00',
    updated_at = '2024-01-02 00:00:00+00'
WHERE id = '00000000-0000-0000-0000-000000000c03';

-- This channel intentionally has no comms_activity row, exercising the
-- ViewedAt epoch fallback and the ViewedUpdated updated_at fallback.
INSERT INTO comms_channels (
  id, name, channel_type, org_id, owner_id, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000c05', 'no-activity', 'public', NULL,
  'macro|user-a@test.com', '2024-01-01 12:00:00+00', '2024-01-02 12:00:00+00'
);

INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at) VALUES (
  '00000000-0000-0000-0000-000000000c05', 'macro|user-a@test.com', 'owner',
  '2024-01-01 12:00:00+00'
);

INSERT INTO comms_activity (id, user_id, channel_id, viewed_at) VALUES
  ('00000000-0000-0000-0000-000000000a01', 'macro|user-a@test.com',
   '00000000-0000-0000-0000-000000000c01', '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-000000000a03', 'macro|user-a@test.com',
   '00000000-0000-0000-0000-000000000c03', '2024-01-04 00:00:00+00');
