-- Explicit queue removal must stop durable producers from re-enqueuing the action.
CREATE TABLE agent_session_cancelled_action (
    agent_session_id uuid NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    action_id uuid NOT NULL,
    PRIMARY KEY (agent_session_id, action_id)
);
