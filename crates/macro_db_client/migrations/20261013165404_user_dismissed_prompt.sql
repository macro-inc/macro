-- Sidebar prompts (setup and import cards) a user dismissed. Stored per user
-- so a dismissal holds on every device; removed with the account.
CREATE TABLE user_dismissed_prompt (
    user_id      TEXT NOT NULL,
    prompt_id    TEXT NOT NULL CHECK (prompt_id ~ '^[a-z0-9][a-z0-9:_-]{0,63}$'),
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, prompt_id)
);
