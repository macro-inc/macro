-- Defaults preserve inserts from the deployed cron-only service, including its
-- database-generated ID. New service writers supply UUIDv7 IDs themselves.
ALTER TABLE scheduled_action
    ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'cron',
    ADD COLUMN event_filters JSONB,
    ADD COLUMN configuration_revision BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN event_activated_at TIMESTAMPTZ,
    ALTER COLUMN schedule DROP NOT NULL,
    ALTER COLUMN timezone DROP NOT NULL,
    ALTER COLUMN next_run_at DROP NOT NULL,
    ADD CONSTRAINT scheduled_action_configuration_revision_check
        CHECK (configuration_revision > 0),
    ADD CONSTRAINT scheduled_action_trigger_shape_check CHECK (
        (
            (trigger_type = 'cron'
                AND schedule IS NOT NULL
                AND timezone IS NOT NULL
                AND next_run_at IS NOT NULL
                AND event_filters IS NULL
                AND event_activated_at IS NULL)
            OR
            (trigger_type = 'events'
                AND schedule IS NULL
                AND timezone IS NULL
                AND next_run_at IS NULL
                AND event_filters IS NOT NULL
                AND CASE WHEN jsonb_typeof(event_filters) = 'array'
                    THEN jsonb_array_length(event_filters) BETWEEN 1 AND 32
                    ELSE FALSE END
                AND event_activated_at IS NOT NULL)
        ) IS TRUE
    );
