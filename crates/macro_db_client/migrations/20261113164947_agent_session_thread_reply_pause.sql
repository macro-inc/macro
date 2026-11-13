-- A thread session whose unmentioned replies are paused: the agent answers
-- only messages that mention it. A row exists only while paused.
CREATE TABLE agent_session_thread_reply_pause (
    session_id UUID PRIMARY KEY REFERENCES agent_session(id) ON DELETE CASCADE,
    paused_by TEXT NOT NULL,
    paused_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
