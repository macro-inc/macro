-- Visibility and speculative runtime lifecycle are separate. No DM visibility
-- changes during migration: old reapers still use the hidden/unthreaded predicate.
ALTER TABLE agent_session ADD COLUMN for_warming BOOLEAN;
UPDATE agent_session s
SET for_warming = s.list_hidden AND s.thread_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM agent_conversation_sessions c WHERE c.session_id = s.id);

-- Older writers omit the marker; older claimants only clear list_hidden.
CREATE FUNCTION agent_session_legacy_warm_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.for_warming IS NULL THEN
        NEW.for_warming := NEW.list_hidden AND NEW.thread_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM agent_conversation_sessions c WHERE c.session_id = NEW.id);
    END IF;
    IF NOT NEW.list_hidden OR NEW.thread_id IS NOT NULL THEN
        NEW.for_warming := FALSE;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER agent_session_legacy_warm_write
BEFORE INSERT OR UPDATE OF list_hidden, thread_id ON agent_session FOR EACH ROW
EXECUTE FUNCTION agent_session_legacy_warm_write();
ALTER TABLE agent_session ALTER COLUMN for_warming SET NOT NULL;
