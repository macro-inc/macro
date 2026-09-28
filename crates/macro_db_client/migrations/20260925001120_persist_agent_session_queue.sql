-- Waiting turn-occupying actions for a session, oldest first.
--
-- One row per session, replaced on every queue mutation. The live replica
-- still holds an in-memory working copy; this is what a restart or a reader
-- on another replica consults. Cascade: a deleted session's queue goes with
-- it. Empty queues delete the row rather than storing `[]`.
CREATE TABLE agent_session_queue (
    agent_session_id UUID PRIMARY KEY REFERENCES agent_session(id) ON DELETE CASCADE,
    -- agent_session::domain::model::StoredQueuedAction, oldest first.
    entries JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
