-- A booking now carries its own abandon time for the booker and host views, and
-- a create refused on its first attempt is marked unsent, since nothing reached
-- the calendar and cancelling it needs no calendar change. Fill both in for
-- bookings abandoned before. Before its start, recovery abandons only on a
-- refusal.
UPDATE scheduling_booking
SET record = jsonb_set(
    jsonb_set(record, '{booking,abandonedAt}', record->'operation'->'abandonedAt'),
    '{operation,unsent}',
    to_jsonb(COALESCE(
        record->'operation'->'kind'->>'kind' = 'create'
            AND (record->'operation'->>'attempt')::bigint = 0
            AND (record->'operation'->>'abandonedAt')::timestamptz < starts_at,
        false
    ))
)
WHERE status = 'failed'
  AND record->'operation' ? 'abandonedAt'
  AND NOT record->'booking' ? 'abandonedAt';
