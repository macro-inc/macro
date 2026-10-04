ALTER TABLE scheduled_action ADD COLUMN trigger_config JSONB;
ALTER TABLE scheduled_action DROP CONSTRAINT scheduled_action_trigger_shape_check;
ALTER TABLE scheduled_action
ADD CONSTRAINT scheduled_action_trigger_shape_check CHECK (
        (
            (trigger_type = 'cron'
                AND schedule IS NOT NULL
                AND timezone IS NOT NULL
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
            OR
            (trigger_type IN ('multiple', 'webhook')
                AND schedule IS NULL AND timezone IS NULL
                AND event_filters IS NULL AND event_activated_at IS NULL
                AND trigger_config IS NOT NULL
                AND trigger_config->>'type' = trigger_type
                AND (trigger_type <> 'webhook' OR next_run_at IS NULL))
        ) IS TRUE
    );
