ALTER TABLE agent_configs
    ADD COLUMN auto_accept_permissions BOOLEAN NULL;

COMMENT ON COLUMN agent_configs.auto_accept_permissions IS
    'Whether the agent''s sessions approve ACP permission requests without asking. NULL defers to the runtime kind''s default: managed runtimes (cursor, in-memory, sandboxed coder) auto-accept, macrod prompts.';
