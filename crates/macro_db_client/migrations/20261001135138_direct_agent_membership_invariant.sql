-- Every participant mutation path (including bot installation) preserves a
-- direct conversation's two-principal boundary. Agents are inserted before
-- members.
CREATE FUNCTION enforce_direct_agent_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    direct_user TEXT;
    direct_bot UUID;
BEGIN
    SELECT user_id, bot_id INTO direct_user, direct_bot
    FROM comms_channel_agents WHERE channel_id = NEW.channel_id AND kind = 'direct';

    IF FOUND AND NEW.user_id <> direct_user AND NEW.user_id <> 'bot|' || direct_bot::TEXT THEN
        RAISE EXCEPTION 'A direct agent conversation only permits its owner and persona'
            USING ERRCODE = '23514', CONSTRAINT = 'direct_agent_participants';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER direct_agent_participants
BEFORE INSERT OR UPDATE OF channel_id, user_id ON comms_channel_participants
FOR EACH ROW EXECUTE FUNCTION enforce_direct_agent_participant();
