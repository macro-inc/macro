-- Who prompted the turn a session is running, and the MCP tool calls that
-- turn is waiting on the owner to approve.
--
-- A session spends its owner's credentials whoever prompts it, so a turn
-- somebody else prompted holds each MCP `tools/call` at the egress proxy
-- until the owner answers. The proxy may run on any replica, and the harness
-- replica managing the session keeps its in-flight turn in memory, so the
-- prompter is written here at dispatch, before the runtime can make a call.
-- Overwritten by the next dispatch, never cleared: a late call from a turn
-- that already ended is still judged by who prompted it.
ALTER TABLE agent_session
    ADD COLUMN turn_action_id UUID,
    -- NULL with a turn_action_id: a bot prompted on nobody's behalf.
    ADD COLUMN turn_prompter TEXT;

-- One held tool call. The row is the source of truth for the hold: the proxy
-- waits on it (woken by NOTIFY on `agent_session_tool_approval`), and exactly
-- one resolution wins, because every resolution is an update of a still
-- pending row.
CREATE TABLE agent_session_tool_approval (
    id UUID PRIMARY KEY,
    agent_session_id UUID NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
    -- The turn the call was made in.
    turn_action_id UUID NOT NULL,
    -- The held call's JSON-RPC id, so the agent's own cancellation of that
    -- request can find it.
    request_id JSONB NOT NULL,
    -- The owner whose access the call spends, and the only one who may
    -- approve or decline it.
    owner_id TEXT NOT NULL,
    -- Who prompted that turn; NULL for a bot acting on nobody's behalf.
    requested_by TEXT,
    -- `macro` for Macro's own server, otherwise the connected app's slug.
    server_slug TEXT NOT NULL,
    server_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    arguments JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired')),
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX agent_session_tool_approval_pending
    ON agent_session_tool_approval (agent_session_id)
    WHERE status = 'pending';
