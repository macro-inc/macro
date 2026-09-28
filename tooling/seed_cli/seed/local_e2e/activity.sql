INSERT INTO activity_events (
  id,
  actor_id,
  subject_id,
  action,
  action_payload,
  entity_type,
  entity_id,
  occurred_at
)
SELECT
  ('00000000-0000-0000-0005-' || lpad(n::text, 12, '0'))::uuid,
  'macro|e2e@macro.local',
  'macro|e2e@macro.local',
  CASE WHEN n = 1 THEN 'created' ELSE 'edited' END,
  NULL,
  CASE WHEN n = 1 THEN 'document' ELSE 'channel' END,
  CASE
    WHEN n = 1 THEN '00000000-0000-0000-0002-000000000001'
    ELSE '00000000-0000-0000-0000-000000000001'
  END,
  TIMESTAMPTZ '2026-08-01 00:00:00+00' + ((n - 1) * INTERVAL '1 minute')
FROM generate_series(1, 60) AS n
ON CONFLICT (id) DO NOTHING
