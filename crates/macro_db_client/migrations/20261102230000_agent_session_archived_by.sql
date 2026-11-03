-- Who archived a session, and when. NULL is an active session.
CREATE TYPE agent_session_archive_cause AS ENUM ('user', 'pull_request_merged', 'runtime_closed');

ALTER TABLE agent_session
    ADD COLUMN archived_by agent_session_archive_cause,
    ADD COLUMN archived_at TIMESTAMPTZ,
    -- The first time a trigger archived the session. Never cleared, so a session a person
    -- restores is not archived by a trigger again.
    ADD COLUMN auto_archived_at TIMESTAMPTZ,
    -- The session's own auto-archive choices. NULL follows the owner's defaults.
    ADD COLUMN auto_archive_on_pull_request_merged BOOLEAN,
    ADD COLUMN auto_archive_on_runtime_closed BOOLEAN;

UPDATE agent_session SET archived_by = 'user', archived_at = modified_at WHERE is_archived;

ALTER TABLE agent_session
    ADD CONSTRAINT agent_session_archived_by_with_archived_at
    CHECK ((archived_by IS NULL) = (archived_at IS NULL));

-- Code from before archived_by still reads and writes is_archived until every replica runs
-- the new code; keep both in step until is_archived is dropped.
CREATE FUNCTION agent_session_sync_is_archived() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
        AND NEW.is_archived IS DISTINCT FROM OLD.is_archived
        AND NEW.archived_by IS NOT DISTINCT FROM OLD.archived_by
    THEN
        NEW.archived_by := CASE WHEN NEW.is_archived THEN 'user'::agent_session_archive_cause END;
        NEW.archived_at := CASE WHEN NEW.is_archived THEN now() END;
    ELSIF TG_OP = 'INSERT' AND NEW.is_archived AND NEW.archived_by IS NULL THEN
        NEW.archived_by := 'user';
        NEW.archived_at := now();
    END IF;
    NEW.is_archived := NEW.archived_by IS NOT NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_session_sync_is_archived
BEFORE INSERT OR UPDATE OF is_archived, archived_by ON agent_session
FOR EACH ROW EXECUTE FUNCTION agent_session_sync_is_archived();

-- Whether a user's agent sessions archive themselves once their work is done.
ALTER TABLE user_agent_coding_preferences
    ADD COLUMN auto_archive_on_pull_request_merged BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN auto_archive_on_runtime_closed BOOLEAN NOT NULL DEFAULT false;
