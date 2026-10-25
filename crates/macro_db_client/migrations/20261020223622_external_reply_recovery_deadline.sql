-- Remember successful posts and bound recovery for prompts never delivered.
ALTER TABLE agent_external_replies
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN announced BOOLEAN NOT NULL DEFAULT FALSE;
