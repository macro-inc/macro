-- Per-copy event content moves onto calendar_event_sources.
--
-- Google keeps several fields per calendar copy of one event (summary,
-- description, location, eventType, visibility, transparency, reminders,
-- creator, and the calendar's access role), so two sources of one entity are
-- not interchangeable. The entity row keeps identity, time, recurrence,
-- organizer, attendees, and conference, plus a denormalized copy of its
-- canonical source's content — the primary calendar's copy when the account
-- syncs one, else the freshest remaining source. Reads that need another
-- copy's content take it from the source row.

ALTER TABLE calendar_event_sources
    ADD COLUMN title text NOT NULL DEFAULT '',
    ADD COLUMN description text,
    ADD COLUMN location text,
    ADD COLUMN event_type text NOT NULL DEFAULT 'default'
        CHECK (event_type IN (
            'default', 'out_of_office', 'focus_time', 'working_location',
            'birthday', 'from_gmail'
        )),
    ADD COLUMN visibility text NOT NULL DEFAULT 'default'
        CHECK (visibility IN ('default', 'public', 'private', 'confidential')),
    ADD COLUMN transparency text NOT NULL DEFAULT 'opaque'
        CHECK (transparency IN ('opaque', 'transparent')),
    ADD COLUMN is_read_only boolean NOT NULL DEFAULT false,
    ADD COLUMN reminders_use_default boolean NOT NULL DEFAULT true,
    ADD COLUMN reminder_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN creator_email text,
    ADD COLUMN creator_name text;

-- The provider update stamp of the schedule the entity currently carries.
-- A canonical copy's sync replaces the schedule only when it is at least this
-- fresh or its own sequence advanced, so a user's edit made through another
-- copy is not undone by an older state of the canonical copy.
ALTER TABLE calendar_events
    ADD COLUMN schedule_updated_at timestamptz NOT NULL DEFAULT now();

UPDATE calendar_events SET schedule_updated_at = canonical_source_updated_at;

-- Every source row already stores its own normalized projection, so its
-- content backfills from there rather than from the entity a later copy may
-- have overwritten. Fields the projection omits at their default read as
-- that default.
UPDATE calendar_event_sources
SET title = COALESCE(normalized_payload -> 'event' ->> 'title', ''),
    description = normalized_payload -> 'event' ->> 'description',
    location = normalized_payload -> 'event' ->> 'location',
    event_type = CASE
        WHEN normalized_payload -> 'event' ->> 'eventType' IN (
            'default', 'out_of_office', 'focus_time', 'working_location',
            'birthday', 'from_gmail'
        ) THEN normalized_payload -> 'event' ->> 'eventType'
        ELSE 'default'
    END,
    visibility = CASE
        WHEN normalized_payload -> 'event' ->> 'visibility' IN (
            'default', 'public', 'private', 'confidential'
        ) THEN normalized_payload -> 'event' ->> 'visibility'
        ELSE 'default'
    END,
    transparency = CASE
        WHEN normalized_payload -> 'event' ->> 'transparency' = 'transparent'
            THEN 'transparent'
        ELSE 'opaque'
    END,
    is_read_only = COALESCE(
        (normalized_payload -> 'event' ->> 'isReadOnly')::boolean, false
    ),
    reminders_use_default = COALESCE(
        (normalized_payload -> 'event' -> 'reminders' ->> 'useDefault')::boolean, true
    ),
    reminder_overrides = COALESCE(
        normalized_payload -> 'event' -> 'reminders' -> 'overrides', '[]'::jsonb
    ),
    creator_email = normalized_payload -> 'event' ->> 'creatorEmail',
    creator_name = normalized_payload -> 'event' ->> 'creatorName';

-- Entities with more than one source hold whichever copy synced last. Rewrite
-- them from the canonical source under the new rule (primary calendar first,
-- then freshest) so the primary copy's type, access, availability,
-- visibility, and reminders are restored without waiting for a resync.
WITH multi_source AS (
    SELECT event_id
    FROM calendar_event_sources
    GROUP BY event_id
    HAVING count(*) > 1
),
canonical AS (
    SELECT DISTINCT ON (source.event_id)
        source.event_id,
        source.title,
        source.description,
        source.location,
        source.event_type,
        source.visibility,
        source.transparency,
        source.is_read_only,
        source.reminders_use_default,
        source.reminder_overrides,
        source.creator_email,
        source.creator_name,
        source.source_sequence,
        source.source_updated_at
    FROM calendar_event_sources source
    JOIN multi_source ON multi_source.event_id = source.event_id
    JOIN calendars calendar ON calendar.id = source.calendar_id
    ORDER BY
        source.event_id,
        calendar.is_primary DESC,
        source.source_sequence DESC,
        source.source_updated_at DESC,
        source.last_seen_at DESC,
        source.id DESC
)
UPDATE calendar_events event
SET title = canonical.title,
    description = canonical.description,
    location = canonical.location,
    event_type = canonical.event_type,
    visibility = canonical.visibility,
    transparency = canonical.transparency,
    is_read_only = canonical.is_read_only,
    reminders_use_default = canonical.reminders_use_default,
    reminder_overrides = canonical.reminder_overrides,
    creator_email = canonical.creator_email,
    creator_name = canonical.creator_name,
    sequence = canonical.source_sequence,
    canonical_source_updated_at = canonical.source_updated_at,
    schedule_updated_at = canonical.source_updated_at
FROM canonical
WHERE event.id = canonical.event_id;

-- The firing schedule of a rewritten entity may have been built from the
-- other copy's reminders. Rebuild it from the restored configuration and the
-- canonical calendar's defaults, mirroring the service's rebuild: status
-- events never resolve calendar defaults, all-day starts anchor at midnight
-- in the calendar's zone, and firings older than a day are dropped.
DELETE FROM calendar_event_reminder_firings firing
USING (
    SELECT event_id
    FROM calendar_event_sources
    GROUP BY event_id
    HAVING count(*) > 1
) multi_source
WHERE firing.event_id = multi_source.event_id;

WITH multi_source AS (
    SELECT event_id
    FROM calendar_event_sources
    GROUP BY event_id
    HAVING count(*) > 1
),
canonical_calendar AS (
    SELECT DISTINCT ON (source.event_id)
        source.event_id,
        calendar.default_reminders,
        CASE
            WHEN calendar.time_zone IS NOT NULL
             AND EXISTS (
                SELECT 1 FROM pg_timezone_names zone WHERE zone.name = calendar.time_zone
             )
            THEN calendar.time_zone
            ELSE 'UTC'
        END AS anchor_zone
    FROM calendar_event_sources source
    JOIN multi_source ON multi_source.event_id = source.event_id
    JOIN calendars calendar ON calendar.id = source.calendar_id
    ORDER BY
        source.event_id,
        calendar.is_primary DESC,
        source.source_sequence DESC,
        source.source_updated_at DESC,
        source.last_seen_at DESC,
        source.id DESC
)
INSERT INTO calendar_event_reminder_firings (
    event_id, occurrence_key, minutes_before, fire_at
)
SELECT DISTINCT
    occurrence.event_id,
    occurrence.occurrence_key,
    offsets.minutes,
    COALESCE(
        occurrence.starts_at,
        occurrence.start_date::timestamp AT TIME ZONE canonical_calendar.anchor_zone
    ) - make_interval(mins => offsets.minutes)
FROM canonical_calendar
JOIN calendar_events event ON event.id = canonical_calendar.event_id
JOIN calendar_event_occurrences occurrence ON occurrence.event_id = event.id
CROSS JOIN LATERAL (
    SELECT (reminder.value ->> 'minutes')::int AS minutes
    FROM jsonb_array_elements(
        CASE
            WHEN event.reminders_use_default
                AND event.event_type IN ('default', 'from_gmail')
                THEN canonical_calendar.default_reminders
            WHEN event.reminders_use_default THEN '[]'::jsonb
            ELSE event.reminder_overrides
        END
    ) AS reminder(value)
    WHERE reminder.value ->> 'method' = 'popup'
      AND (reminder.value ->> 'minutes')::int >= 0
) offsets
WHERE event.status <> 'cancelled'
  AND NOT occurrence.is_cancelled
  AND COALESCE(
        occurrence.starts_at,
        occurrence.start_date::timestamp AT TIME ZONE canonical_calendar.anchor_zone
      ) - make_interval(mins => offsets.minutes) > now() - interval '1 day'
ON CONFLICT (event_id, occurrence_key, minutes_before) DO NOTHING;
