-- Named compute tier for a managed coding-agent sandbox. Disk is always
-- 96 GiB; CPU and RAM vary. Existing sessions keep the product default.
ALTER TABLE agent_session
    ADD COLUMN sandbox_size TEXT NOT NULL DEFAULT 'default'
        CHECK (sandbox_size IN ('small', 'default', 'large'));

-- Per-user default applied when @coder opens a new session.
CREATE TABLE user_agent_sandbox_size (
    user_id TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    sandbox_size TEXT NOT NULL
        CHECK (sandbox_size IN ('small', 'default', 'large')),
    modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
