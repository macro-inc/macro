-- Routines can fire once at an exact time, alone or among other triggers.
-- A once routine keeps its configuration in trigger_config, like `multiple`.
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
        (trigger_type = 'once'
            AND schedule IS NULL
            AND timezone IS NULL
            AND event_filters IS NULL
            AND event_activated_at IS NULL
            AND trigger_config IS NOT NULL
            AND trigger_config->>'type' = 'once'
            AND trigger_config->>'at' IS NOT NULL)
        OR
        (trigger_type = 'multiple'
            AND schedule IS NULL
            AND timezone IS NULL
            AND trigger_config IS NOT NULL
            AND trigger_config->>'type' = 'multiple'
            AND (
                (event_filters IS NULL AND event_activated_at IS NULL)
                OR
                (event_filters IS NOT NULL AND event_activated_at IS NOT NULL
                    AND CASE WHEN jsonb_typeof(event_filters) = 'array'
                        THEN jsonb_array_length(event_filters) BETWEEN 1 AND 32
                        ELSE FALSE END)
            ))
    ) IS TRUE
);

-- A routine contains between one and sixteen schedule, once and event triggers.
ALTER TABLE scheduled_action DROP CONSTRAINT scheduled_action_supported_triggers_check;
ALTER TABLE scheduled_action
ADD CONSTRAINT scheduled_action_supported_triggers_check CHECK (
    (trigger_type IN ('cron', 'events', 'once') OR (
        trigger_type = 'multiple'
        AND CASE WHEN jsonb_typeof(trigger_config->'triggers') = 'array'
            THEN jsonb_array_length(trigger_config->'triggers') BETWEEN 1 AND 16
                AND jsonb_array_length(jsonb_path_query_array(
                    trigger_config,
                    '$.triggers[*] ? (@.type == "cron" || @.type == "events" || @.type == "once")'
                )) = jsonb_array_length(trigger_config->'triggers')
            ELSE FALSE END
    )) IS TRUE
);
