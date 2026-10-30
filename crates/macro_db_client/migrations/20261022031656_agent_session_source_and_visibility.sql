-- Who started the session (a person, or a routine's unattended run), and
-- where it is shown:
--   listed:   wherever the owner's sessions are;
--   unlisted: left out of Home and default lists, but a filter can ask for it
--             (a routine's runs, unless the routine lists them);
--   hidden:   out of every list and search, reachable only by id (warm,
--             DM-backing and inline @macro thread sessions).
-- `visibility = 'hidden'` replaces `list_hidden`. Until a later migration drops
-- `list_hidden`, a trigger keeps the two in step for replicas still running
-- code that reads or writes only `list_hidden`.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_session
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'listed';

CREATE OR REPLACE FUNCTION agent_session_sync_list_hidden() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.visibility = 'hidden' THEN
            NEW.list_hidden := TRUE;
        ELSIF NEW.list_hidden THEN
            NEW.visibility := 'hidden';
        END IF;
    ELSIF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
        NEW.list_hidden := NEW.visibility = 'hidden';
    ELSIF NEW.list_hidden IS DISTINCT FROM OLD.list_hidden THEN
        NEW.visibility := CASE WHEN NEW.list_hidden THEN 'hidden' ELSE 'listed' END;
    END IF;
    RETURN NEW;
END
$$;

-- Triggers fire in name order. This one must run before
-- `agent_session_legacy_warm_write`, which reads `list_hidden` to settle
-- `for_warming` on insert.
DROP TRIGGER IF EXISTS agent_session_hidden_sync ON agent_session;
CREATE TRIGGER agent_session_hidden_sync
    BEFORE INSERT OR UPDATE OF visibility, list_hidden ON agent_session
    FOR EACH ROW EXECUTE FUNCTION agent_session_sync_list_hidden();
