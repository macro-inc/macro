-- "Approve, and don't ask me again": the owner lets one person make a kind
-- of tool call in one session without being asked each time.
--
-- On Macro's own server a standing approval covers one tool, because that one
-- server reaches all of the owner's data. A connected app is covered whole.
-- It lasts as long as the session.
CREATE TABLE agent_session_tool_standing_approval (
    agent_session_id UUID NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
    -- Who may now make the calls without asking.
    user_id TEXT NOT NULL,
    -- `macro` for Macro's own server, otherwise the connected app's slug.
    server_slug TEXT NOT NULL,
    -- The one tool covered on Macro's server; NULL for a whole connected app.
    tool_name TEXT,
    -- The owner who said so.
    granted_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_session_tool_standing_approval_scope
    ON agent_session_tool_standing_approval (
        agent_session_id, user_id, server_slug, (COALESCE(tool_name, ''))
    );

-- Whether an approval was given for good, so the session's log can say so.
ALTER TABLE agent_session_tool_approval
    ADD COLUMN remembered BOOLEAN NOT NULL DEFAULT false;
