-- Source bodies outlive revisions; only deleting the owning session reclaims them.
-- No FK: cleanup must survive the session's cascade. Delay past any capture lease.
CREATE TABLE agent_review_cleanup (
    agent_session_id UUID PRIMARY KEY,
    available_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE FUNCTION enqueue_agent_review_cleanup() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO agent_review_cleanup (agent_session_id) VALUES (OLD.id)
    ON CONFLICT (agent_session_id) DO NOTHING;
    RETURN OLD;
END;
$$;
CREATE TRIGGER agent_session_review_cleanup AFTER DELETE ON agent_session
FOR EACH ROW EXECUTE FUNCTION enqueue_agent_review_cleanup();
