-- The calendar that owns an event's reminder settings and defaults. Google
-- lets only a primary calendar carry status types and treats reminders as the
-- owner's rather than a viewer's, so when the same event is synced from several
-- calendars (a shared calendar re-importing a member's event, a teammate's
-- reader access) its reminders belong to the primary source. This ranks a
-- primary source ahead of the freshness order used to pick the canonical
-- projection, and ignores deleted calendars and disabled accounts, so every
-- reminder rebuild agrees on which calendar's defaults and time zone apply.
CREATE OR REPLACE FUNCTION reminder_owner_calendar_id(target_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT source.calendar_id
    FROM calendar_event_sources source
    JOIN calendars calendar ON calendar.id = source.calendar_id
    JOIN calendar_accounts account ON account.id = source.account_id
    WHERE source.event_id = target_event_id
      AND NOT calendar.is_deleted
      AND account.sync_status <> 'disabled'
    ORDER BY
        calendar.is_primary DESC,
        source.source_sequence DESC,
        source.source_updated_at DESC,
        source.last_seen_at DESC,
        source.id DESC
    LIMIT 1
$$;
