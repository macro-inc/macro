-- Routines can run when their owner's phone arrives at or leaves a place,
-- alone or among other triggers. A location routine keeps its configuration
-- in trigger_config, like `once`, and has no schedule of its own.
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
        (trigger_type = 'location'
            AND schedule IS NULL
            AND timezone IS NULL
            AND next_run_at IS NULL
            AND event_filters IS NULL
            AND event_activated_at IS NULL
            AND trigger_config IS NOT NULL
            AND trigger_config->>'type' = 'location'
            AND trigger_config->'place' IS NOT NULL)
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

ALTER TABLE scheduled_action DROP CONSTRAINT scheduled_action_supported_triggers_check;
ALTER TABLE scheduled_action
ADD CONSTRAINT scheduled_action_supported_triggers_check CHECK (
    (trigger_type IN ('cron', 'events', 'once', 'location') OR (
        trigger_type = 'multiple'
        AND CASE WHEN jsonb_typeof(trigger_config->'triggers') = 'array'
            THEN jsonb_array_length(trigger_config->'triggers') BETWEEN 1 AND 16
                AND jsonb_array_length(jsonb_path_query_array(
                    trigger_config,
                    '$.triggers[*] ? (@.type == "cron" || @.type == "events" || @.type == "once" || @.type == "location")'
                )) = jsonb_array_length(trigger_config->'triggers')
            ELSE FALSE END
    )) IS TRUE
);

-- A phone that reports place crossings for its owner's routines. Only the
-- token's SHA-256 is kept; the raw token is returned once, to the app that
-- registered the phone, which keeps it in the device's secure storage.
CREATE TABLE scheduled_action_location_device (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scheduled_action_location_device_user_id_idx
    ON scheduled_action_location_device(user_id);

-- When each of a routine's places last started it. GPS jitter makes phones
-- report a crossing several times, and an owner may carry two phones; a place
-- runs its routine at most once per cooldown.
CREATE TABLE scheduled_action_location_firing (
    action_id UUID NOT NULL REFERENCES scheduled_action(id) ON DELETE CASCADE,
    fence TEXT NOT NULL,
    fired_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (action_id, fence)
);

-- Sessions a location crossing opened.
ALTER TABLE agent_session_source DROP CONSTRAINT agent_session_source_routine_firing;
ALTER TABLE agent_session_source
ADD CONSTRAINT agent_session_source_routine_firing CHECK (
    routine_firing IS NULL OR routine_firing IN ('scheduled', 'manual', 'event', 'location')
);
