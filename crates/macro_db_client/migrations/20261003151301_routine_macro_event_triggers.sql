-- Retain the original cron/event shapes while allowing schedules and events together.
ALTER TABLE scheduled_action DROP CONSTRAINT scheduled_action_trigger_shape_check;
ALTER TABLE scheduled_action ADD CONSTRAINT scheduled_action_trigger_shape_check CHECK (
    ((trigger_type = 'cron' AND schedule IS NOT NULL AND timezone IS NOT NULL
        AND event_filters IS NULL AND event_activated_at IS NULL)
    OR (trigger_type = 'events' AND schedule IS NULL AND timezone IS NULL
        AND next_run_at IS NULL AND event_filters IS NOT NULL
        AND jsonb_typeof(event_filters) = 'array'
        AND jsonb_array_length(event_filters) BETWEEN 1 AND 32
        AND event_activated_at IS NOT NULL)
    OR (trigger_type = 'multiple' AND schedule IS NULL AND timezone IS NULL
        AND trigger_config IS NOT NULL AND trigger_config->>'type' = 'multiple'
        AND ((event_filters IS NULL AND event_activated_at IS NULL)
            OR (event_filters IS NOT NULL AND event_activated_at IS NOT NULL
                AND jsonb_typeof(event_filters) = 'array'
                AND jsonb_array_length(event_filters) BETWEEN 1 AND 32)))
    -- Older locally-created webhook rows remain inert and can be deleted by their owner.
    OR (trigger_type = 'webhook' AND schedule IS NULL AND timezone IS NULL
        AND next_run_at IS NULL AND event_filters IS NULL AND event_activated_at IS NULL
        AND trigger_config->>'type' = 'webhook')) IS TRUE
);
