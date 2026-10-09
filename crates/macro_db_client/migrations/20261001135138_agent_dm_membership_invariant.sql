-- Every participant mutation path (including bot installation) preserves a
-- persona DM's two-principal boundary. Bindings are inserted before members.
CREATE FUNCTION enforce_agent_dm_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    dm_user TEXT;
    dm_bot UUID;
BEGIN
    SELECT user_id, bot_id INTO dm_user, dm_bot
    FROM comms_agent_dms WHERE channel_id = NEW.channel_id;

    IF FOUND AND NEW.user_id <> dm_user AND NEW.user_id <> 'bot|' || dm_bot::TEXT THEN
        RAISE EXCEPTION 'An agent DM only permits its owner and persona'
            USING ERRCODE = '23514', CONSTRAINT = 'agent_dm_participants';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_dm_participants
BEFORE INSERT OR UPDATE OF channel_id, user_id ON comms_channel_participants
FOR EACH ROW EXECUTE FUNCTION enforce_agent_dm_participant();
