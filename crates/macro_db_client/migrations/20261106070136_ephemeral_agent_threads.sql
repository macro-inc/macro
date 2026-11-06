-- Private threads are durable; their audience is fixed at creation.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_configs ADD COLUMN is_ephemeral boolean NOT NULL DEFAULT false;
ALTER TABLE comms_messages ADD COLUMN visibility jsonb NOT NULL DEFAULT '{"type":"public"}'::jsonb;

-- A reply inherits its root's audience, including for older writers. Updates
-- cannot accidentally publish a private thread or add a new reader.
CREATE FUNCTION comms_message_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    root_visibility jsonb;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
            RAISE EXCEPTION 'message visibility is immutable' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.thread_id IS NOT NULL THEN
        SELECT visibility INTO root_visibility FROM comms_messages WHERE id = NEW.thread_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'thread root must exist before its replies' USING ERRCODE = '23503';
        END IF;
        IF NEW.visibility->>'type' = 'private' AND NEW.visibility IS DISTINCT FROM root_visibility THEN
            RAISE EXCEPTION 'private replies must match their thread audience' USING ERRCODE = '23514';
        END IF;
        NEW.visibility := root_visibility;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER comms_message_visibility BEFORE INSERT OR UPDATE OF visibility ON comms_messages
FOR EACH ROW EXECUTE FUNCTION comms_message_visibility();

-- Sessions retain their audience even after their root is purged (the root FK
-- becomes NULL). Every writer, including older runtimes, inherits it here.
ALTER TABLE agent_session ADD COLUMN message_visibility jsonb NOT NULL DEFAULT '{"type":"public"}'::jsonb;
CREATE FUNCTION agent_session_message_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.thread_id IS NOT NULL THEN
            SELECT visibility INTO NEW.message_visibility FROM comms_messages WHERE id = NEW.thread_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'session root must exist' USING ERRCODE = '23503';
            END IF;
        END IF;
        IF NEW.message_visibility->>'type' = 'private' AND NEW.owner_id IS DISTINCT FROM NEW.message_visibility->>'user_id' THEN
            RAISE EXCEPTION 'private session owner must match its audience' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.message_visibility IS DISTINCT FROM OLD.message_visibility THEN
        RAISE EXCEPTION 'session message audience is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER agent_session_message_visibility BEFORE INSERT OR UPDATE OF message_visibility ON agent_session
FOR EACH ROW EXECUTE FUNCTION agent_session_message_visibility();

-- Private sessions cannot acquire grants through generic sharing workflows,
-- human mentions, or inherited folder/team/channel grants.
CREATE FUNCTION private_agent_session_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE audience jsonb;
BEGIN
    IF NEW.entity_type = 'agent_session' THEN
        SELECT message_visibility INTO audience FROM agent_session WHERE id = NEW.entity_id;
        IF audience->>'type' = 'private' AND
            (NEW.source_type <> 'user' OR NEW.source_id IS DISTINCT FROM audience->>'user_id' OR NEW.granted_from_project_id IS NOT NULL) THEN
            RAISE EXCEPTION 'private agent sessions cannot be shared' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER private_agent_session_grant BEFORE INSERT OR UPDATE ON entity_access
FOR EACH ROW EXECUTE FUNCTION private_agent_session_grant();
