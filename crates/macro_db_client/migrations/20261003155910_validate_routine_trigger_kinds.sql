-- Routine inputs support schedules and Macro activity events only.
-- This forward-only constraint also validates the members of a mixed trigger.
ALTER TABLE scheduled_action ADD CONSTRAINT scheduled_action_supported_triggers_check CHECK (
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
