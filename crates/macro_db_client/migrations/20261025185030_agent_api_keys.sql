-- An agent's own Anthropic or OpenAI API key. An in-memory agent with one
-- runs every turn on it instead of Macro's allowance; usage on it is recorded
-- against the key and never counted. One key per agent, for the provider of
-- the agent's model; it goes when the agent's bot row does.
SET LOCAL lock_timeout = '5s';

CREATE TABLE agent_api_keys (
    bot_id             UUID PRIMARY KEY REFERENCES bots (id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    -- The key's public prefix, written from the parsed plaintext before it is
    -- encrypted. Postgres cannot read the ciphertext, so this is how it
    -- refuses a key whose shape does not match its provider.
    key_prefix         TEXT NOT NULL,
    key_ciphertext     BYTEA NOT NULL,
    encryption_version SMALLINT NOT NULL,
    kms_key_id         TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_api_keys_provider_known CHECK (provider IN ('anthropic', 'openai')),
    CONSTRAINT agent_api_keys_key_prefix CHECK (
        CASE provider
            WHEN 'anthropic' THEN key_prefix = 'sk-ant-'
            WHEN 'openai' THEN key_prefix = 'sk-'
            ELSE FALSE
        END
    )
);

-- Usage paid for by an agent's own key: recorded for visibility and never
-- counted against Macro usage. Added NOT VALID so this only takes a brief lock
-- on `ai_usage`; a later migration validates it and indexes the column outside
-- a transaction.
ALTER TABLE ai_usage ADD COLUMN agent_api_key_id UUID;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_agent_api_key_id_fkey
    FOREIGN KEY (agent_api_key_id) REFERENCES agent_api_keys (bot_id) ON DELETE SET NULL
    NOT VALID;
