-- Inline @macro sessions (a channel or document mention) start hidden from
-- the agents list and search. Opening the session pins it for that user,
-- permanently. Sessions created anywhere else stay listed (`list_hidden`
-- defaults false, so rows written before this column existed stay visible).
ALTER TABLE agent_session
    ADD COLUMN list_hidden BOOLEAN NOT NULL DEFAULT false;

-- Per-viewer promotion. The primary key is the lookup the list and search
-- queries make: this user, this session.
CREATE TABLE agent_session_list_pin (
    user_id          TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    agent_session_id UUID        NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    promoted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, agent_session_id)
);
