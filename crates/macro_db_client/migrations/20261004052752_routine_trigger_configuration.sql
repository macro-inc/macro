-- Extend the existing scheduled action schema for completed one-offs and
-- routines that combine schedules with Macro activity events.
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

-- A routine contains between one and sixteen schedule/event trigger groups.
ALTER TABLE scheduled_action
ADD CONSTRAINT scheduled_action_supported_triggers_check CHECK (
    (trigger_type IN ('cron', 'events') OR (
        trigger_type = 'multiple'
        AND CASE WHEN jsonb_typeof(trigger_config->'triggers') = 'array'
            THEN jsonb_array_length(trigger_config->'triggers') BETWEEN 1 AND 16
                AND jsonb_array_length(jsonb_path_query_array(
                    trigger_config, '$.triggers[*] ? (@.type == "cron" || @.type == "events")'
                )) = jsonb_array_length(trigger_config->'triggers')
            ELSE FALSE END
    )) IS TRUE
);

-- Event-only and mixed routines use the same event matching query.
DROP INDEX scheduled_action_event_filters_idx;
CREATE INDEX scheduled_action_event_filters_idx
    ON scheduled_action USING GIN (event_filters jsonb_path_ops)
    WHERE event_filters IS NOT NULL AND enabled;
