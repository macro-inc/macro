-- The agent session a correlated row came from, so a session's activity is one
-- index scan instead of a lookup per code-mode run. Nullable without a default,
-- so adding it rewrites nothing; rows without a correlation stay NULL.
--
-- A trigger fills it from the correlation's mapping, so every writer sets it,
-- including binaries deployed before this column existed. The lookup is the
-- `agent_correlations` primary key, once per correlated insert. Deleting a
-- session cascades its mappings but keeps its activity, like the correlation.
SET LOCAL lock_timeout = '5s';

ALTER TABLE activity_events ADD COLUMN agent_session_id UUID;

CREATE FUNCTION activity_events_agent_session_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.agent_correlation_id IS NOT NULL AND NEW.agent_session_id IS NULL THEN
        SELECT agent_session_id INTO NEW.agent_session_id
        FROM agent_correlations
        WHERE id = NEW.agent_correlation_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER activity_events_agent_session_id
    BEFORE INSERT ON activity_events
    FOR EACH ROW
    WHEN (NEW.agent_correlation_id IS NOT NULL)
    EXECUTE FUNCTION activity_events_agent_session_id();
