-- A booking now carries its own abandon time for the booker and host views.
-- Copy it onto bookings abandoned before the booking had it.
UPDATE scheduling_booking
SET record = jsonb_set(record, '{booking,abandonedAt}', record->'operation'->'abandonedAt')
WHERE status = 'failed'
  AND record->'operation' ? 'abandonedAt'
  AND NOT record->'booking' ? 'abandonedAt';
