-- `cursor_configs` holds every bring-your-own model provider key, not just
-- Cursor's. A `provider` column says whose key a row is, so adding a provider
-- is a new allowed value rather than a new table.
--
-- Cursor keys stay per user. Anthropic and OpenAI keys belong to a team: any
-- member's in-memory AI chat may run on them, and the session gate checks
-- membership on every turn through `team_user`, so leaving the team ends
-- access immediately.
--
-- Compatible with the deployed Cursor code, which upserts with
-- `ON CONFLICT (user_id)` and reads `WHERE user_id = $1`: `user_id` keeps a
-- unique constraint (NULLs never conflict, so team rows coexist with it), new
-- columns default to a Cursor row, and team rows carry no `user_id` for those
-- reads to find.
SET LOCAL lock_timeout = '5s';

ALTER TABLE cursor_configs
    -- A stable id for `ai_usage.provider_api_key_id` to reference.
    ADD COLUMN id         UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN provider   TEXT NOT NULL DEFAULT 'cursor',
    ADD COLUMN team_id    UUID REFERENCES team (id) ON DELETE CASCADE,
    -- The key's public prefix, written from the parsed plaintext before it is
    -- encrypted. Postgres cannot read the ciphertext, so this is how it
    -- refuses a key whose shape does not match its provider. NULL only for
    -- Cursor rows registered before the column existed.
    ADD COLUMN key_prefix TEXT;

ALTER TABLE cursor_configs DROP CONSTRAINT cursor_api_keys_pkey;
ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_pkey PRIMARY KEY (id);
ALTER TABLE cursor_configs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_user_id_key UNIQUE (user_id);
ALTER TABLE cursor_configs
    ADD CONSTRAINT cursor_configs_team_provider_key UNIQUE (team_id, provider);

ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_provider_known
    CHECK (provider IN ('cursor', 'anthropic', 'openai'));

ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_owner CHECK (
    CASE provider
        WHEN 'cursor' THEN user_id IS NOT NULL AND team_id IS NULL
        ELSE team_id IS NOT NULL AND user_id IS NULL
    END
);

ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_key_prefix CHECK (
    CASE provider
        WHEN 'cursor' THEN key_prefix IS NULL OR key_prefix IN ('crsr_', 'grok_')
        WHEN 'anthropic' THEN key_prefix IS NOT DISTINCT FROM 'sk-ant-'
        WHEN 'openai' THEN key_prefix IS NOT DISTINCT FROM 'sk-'
        ELSE FALSE
    END
);

ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_default_model_cursor_only
    CHECK (provider = 'cursor' OR default_model_id IS NULL);

-- Usage paid for by a team's own key: recorded for the team's visibility and
-- never counted against the member's Macro allowance. The constraint is added
-- NOT VALID so this migration only takes a brief lock on `ai_usage`; the next
-- migration validates it and indexes the column outside a transaction.
ALTER TABLE ai_usage ADD COLUMN provider_api_key_id UUID;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_provider_api_key_id_fkey
    FOREIGN KEY (provider_api_key_id) REFERENCES cursor_configs (id) ON DELETE SET NULL
    NOT VALID;
