-- When the event's most recent reminder notification was delivered. Soup
-- recency sorts use GREATEST(updated_at, last_reminder_fired_at) so the inbox
-- row a fired alarm surfaces sits at delivery time instead of the event's
-- Google last-modified time.
ALTER TABLE calendar_events
    ADD COLUMN last_reminder_fired_at timestamptz;

-- Backfill from already-delivered reminder notifications so rows currently
-- misplaced in inboxes move to their delivery time without waiting for the
-- next firing. notification.created_at is a bare timestamp stored as UTC.
UPDATE calendar_events e
SET last_reminder_fired_at = delivered.fired_at
FROM (
    SELECT n.event_item_id, MAX(n.created_at AT TIME ZONE 'UTC') AS fired_at
    FROM notification n
    WHERE n.event_item_type = 'calendar_event'
      AND n.notification_event_type = 'calendar_event_reminder'
    GROUP BY n.event_item_id
) delivered
WHERE e.id::text = delivered.event_item_id;
