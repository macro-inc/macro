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
