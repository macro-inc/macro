-- 130 more channels for user-a (the owner of channels_repo.sql's c01), each
-- viewed recently but last updated long ago, so the viewed-or-updated sort
-- follows the activity rows. With channels_repo.sql's, user-a has more than
-- 100 activity rows: a list page must read the activity of the channels on
-- it, not the user's latest 100.
CREATE TEMP TABLE walk_viewer AS
SELECT owner_id AS user_id
FROM comms_channels
WHERE id = '00000000-0000-0000-0000-000000000c01';

INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at)
SELECT
  ('00000000-0000-0000-0000-' || lpad(to_hex(53248 + i), 12, '0'))::uuid,
  'walk-' || i,
  'public',
  NULL,
  v.user_id,
  '2020-01-01 00:00:00+00'::timestamptz + make_interval(secs => i),
  '2020-01-01 00:00:00+00'::timestamptz + make_interval(secs => i)
FROM generate_series(1, 130) AS i, walk_viewer v;

INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
SELECT
  ('00000000-0000-0000-0000-' || lpad(to_hex(53248 + i), 12, '0'))::uuid,
  v.user_id,
  'owner',
  '2020-01-01 00:00:00+00'
FROM generate_series(1, 130) AS i, walk_viewer v;

INSERT INTO comms_activity (id, user_id, channel_id, viewed_at)
SELECT
  ('00000000-0000-0000-0000-' || lpad(to_hex(57344 + i), 12, '0'))::uuid,
  v.user_id,
  ('00000000-0000-0000-0000-' || lpad(to_hex(53248 + i), 12, '0'))::uuid,
  '2026-01-01 00:00:00'::timestamp + make_interval(mins => i)
FROM generate_series(1, 130) AS i, walk_viewer v;

DROP TABLE walk_viewer;
