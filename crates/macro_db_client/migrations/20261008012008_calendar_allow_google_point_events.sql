-- Google can return timed point events with equal start/end instants.
-- Relax only timed event shapes; all-day spans and booking durations stay positive.
-- Defer scans to a later migration so these write locks cover only replacement.

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
    ) NOT VALID;

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
    ) NOT VALID;

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
    ) NOT VALID;
