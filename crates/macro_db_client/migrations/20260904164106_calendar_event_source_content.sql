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

-- Ranks one event's copies and returns the canonical one: the primary
-- calendar's copy, else a copy the grant can write, else the freshest, on a
-- live calendar of an enabled account. Every ranking site calls this so the
-- entity content, the mutation target, the reminder schedule, and the
-- listing order agree on which copy is canonical.
CREATE FUNCTION calendar_event_canonical_source_id(target_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT source.id
    FROM calendar_event_sources source
    JOIN calendars calendar ON calendar.id = source.calendar_id
    JOIN calendar_accounts account ON account.id = source.account_id
    WHERE source.event_id = target_event_id
      AND NOT calendar.is_deleted
      AND account.sync_status <> 'disabled'
    ORDER BY
        calendar.is_primary DESC,
        (calendar.access_role IN ('owner', 'writer')) DESC NULLS LAST,
        source.source_sequence DESC,
        source.source_updated_at DESC,
        source.id DESC
    LIMIT 1
$$;

-- Which copy last wrote the entity's schedule (status, time, recurrence,
-- occurrences, and for the canonical copy also attendees, organizer, and
-- conference) and that write's provider update stamp. The canonical copy
-- takes the schedule when it is new to Macro, advanced its own sequence, or
-- is at least this fresh, a user edit through another copy lands when it is
-- at least this fresh, and the writing copy keeps writing it until then.
-- Retiring the writing copy hands the schedule back to the canonical one.
-- content_source_id names the copy whose content the entity mirrors, so a
-- ranking change that happens without a source write (a calendar's role or
-- primary flag changing) can be detected and the entity re-projected.
ALTER TABLE calendar_events
    ADD COLUMN content_source_id uuid
        REFERENCES calendar_event_sources(id) ON DELETE SET NULL,
    ADD COLUMN schedule_source_id uuid
        REFERENCES calendar_event_sources(id) ON DELETE SET NULL,
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
-- them from the canonical copy so the primary copy's type, access,
-- availability, visibility, and reminders are restored without waiting for a
-- resync.
WITH multi_source AS (
    SELECT event_id
    FROM calendar_event_sources
    GROUP BY event_id
    HAVING count(*) > 1
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
    sequence = canonical.source_sequence
FROM calendar_event_sources canonical
JOIN multi_source ON multi_source.event_id = canonical.event_id
WHERE event.id = canonical.event_id
  AND canonical.id = calendar_event_canonical_source_id(event.id);

-- Every entity's content and schedule are attributed to its canonical copy.
UPDATE calendar_events event
SET content_source_id = canonical.id,
    schedule_source_id = canonical.id,
    schedule_updated_at = canonical.source_updated_at
FROM calendar_event_sources canonical
WHERE canonical.id = calendar_event_canonical_source_id(event.id);

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
    SELECT
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
    WHERE source.id = calendar_event_canonical_source_id(source.event_id)
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

-- The canonical copy's stamp had one reader, the old cross-copy precedence
-- guard, which the per-copy freshness rules above replace.
ALTER TABLE calendar_events DROP COLUMN canonical_source_updated_at;
