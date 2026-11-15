-- Routine webhooks: a POST to a routine's webhook URL starts a run of it.
--
-- The `webhook` trigger in a routine's list holds no secret. A routine has at
-- most one URL, minted by its owner: `hook_id` is the URL's public id and
-- `secret_hash` the SHA-256 of its random 256-bit secret, which is never
-- stored. Rotating replaces both; removing the trigger or deleting the
-- routine deletes the row, which revokes the URL.
CREATE TABLE scheduled_action_webhook (
    action_id UUID PRIMARY KEY REFERENCES scheduled_action (id) ON DELETE CASCADE,
    hook_id UUID NOT NULL UNIQUE,
    secret_hash BYTEA NOT NULL CHECK (octet_length(secret_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

-- A routine's trigger list may now hold a webhook trigger. NOT VALID so no
-- scan runs under the ACCESS EXCLUSIVE lock; the next migration validates it.
SET LOCAL lock_timeout = '5s';

ALTER TABLE scheduled_action DROP CONSTRAINT scheduled_action_supported_triggers_check;
ALTER TABLE scheduled_action
ADD CONSTRAINT scheduled_action_supported_triggers_check CHECK (
    (trigger_type IN ('cron', 'events', 'once') OR (
        trigger_type = 'multiple'
        AND CASE WHEN jsonb_typeof(trigger_config->'triggers') = 'array'
            THEN jsonb_array_length(trigger_config->'triggers') BETWEEN 1 AND 16
                AND jsonb_array_length(jsonb_path_query_array(
                    trigger_config,
                    '$.triggers[*] ? (@.type == "cron" || @.type == "events" || @.type == "once" || @.type == "webhook")'
                )) = jsonb_array_length(trigger_config->'triggers')
            ELSE FALSE END
    )) IS TRUE
) NOT VALID;
