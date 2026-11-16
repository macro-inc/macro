SET LOCAL lock_timeout = '5s';

-- A session whose log carries a harness-authored notification prompt reads its
-- original frames across load boundaries. Record that fact once on the session
-- so history reads do not probe every prompt's JSON for it.
ALTER TABLE agent_session
    ADD COLUMN has_trusted_notifications boolean NOT NULL DEFAULT false;

-- A trigger rather than the repository, so replicas still on older code set it
-- during a rolling deploy. BEFORE INSERT tests the incoming value, not a
-- TOASTed copy. The flag only ever turns on.
CREATE FUNCTION mark_agent_session_trusted_notifications()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE agent_session
    SET has_trusted_notifications = true
    WHERE id = NEW.agent_session_id AND NOT has_trusted_notifications;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_session_log_mark_trusted_notifications
    BEFORE INSERT ON agent_session_log
    FOR EACH ROW
    WHEN (
        NEW.direction IN ('notification', 'to_runtime')
        AND NEW.content->'params'->'_meta' ? 'macro.dev/notifications'
    )
    EXECUTE FUNCTION mark_agent_session_trusted_notifications();
