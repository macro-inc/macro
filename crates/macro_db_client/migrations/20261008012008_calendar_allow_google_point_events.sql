-- Google can return timed point events with equal start/end instants.
-- Relax only timed event shapes; all-day spans and booking durations stay positive.

ALTER TABLE calendar_events
    DROP CONSTRAINT calendar_events_time_shape,
    ADD CONSTRAINT calendar_events_time_shape CHECK (
        (
            starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND start_date IS NULL
            AND end_date IS NULL
            AND ends_at >= starts_at
        )
        OR
        (
            starts_at IS NULL
            AND ends_at IS NULL
            AND start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND end_date > start_date
        )
    );

ALTER TABLE calendar_event_overrides
    DROP CONSTRAINT calendar_event_overrides_time_shape,
    ADD CONSTRAINT calendar_event_overrides_time_shape CHECK (
        (
            starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND start_date IS NULL
            AND end_date IS NULL
            AND ends_at >= starts_at
        )
        OR
        (
            starts_at IS NULL
            AND ends_at IS NULL
            AND start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND end_date > start_date
        )
    );

ALTER TABLE calendar_event_occurrences
    DROP CONSTRAINT calendar_event_occurrences_time_shape,
    ADD CONSTRAINT calendar_event_occurrences_time_shape CHECK (
        (
            starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND start_date IS NULL
            AND end_date IS NULL
            AND ends_at >= starts_at
        )
        OR
        (
            starts_at IS NULL
            AND ends_at IS NULL
            AND start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND end_date > start_date
        )
    );

-- Point events have an empty generated timed_span, so their browse predicate
-- uses this narrow index without treating an instant as occupied duration.
CREATE INDEX calendar_event_occurrences_points_idx
    ON calendar_event_occurrences (owner_id, starts_at, event_id, occurrence_key)
    WHERE NOT is_cancelled AND starts_at = ends_at;
