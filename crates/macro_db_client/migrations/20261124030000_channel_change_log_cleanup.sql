-- A removed channel takes its change history and its counter with it. The
-- tables have no foreign key to the channel, so nothing else removes them.
-- This trigger's name sorts after the channel's foreign-key triggers, so it
-- runs once the channel's messages are gone and takes the counter lock last,
-- as every writer does.
CREATE FUNCTION cleanup_channel_change_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM channel_change_log WHERE channel_id = OLD.id;
    DELETE FROM channel_change_counters WHERE channel_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER cleanup_channel_change_log
    AFTER DELETE ON comms_channels
    FOR EACH ROW EXECUTE FUNCTION cleanup_channel_change_log();

-- Removing a person removes the calls they own, and no service code runs for
-- it. A call discussed in a channel thread is the root of that thread, so the
-- channel records the change here; clients then read the root again. The calls
-- are removed first, so their own cleanup has taken its locks before any
-- counter is locked, and counters lock in channel order as activity batches do.
CREATE OR REPLACE FUNCTION cleanup_user_call_entities() RETURNS trigger
LANGUAGE plpgsql
SET lock_timeout = '5s'
AS $$
DECLARE
    channels uuid[];
    calls uuid[];
BEGIN
    WITH gone AS (
        DELETE FROM call_entities WHERE user_id = OLD.id
        RETURNING id, channel_id, discussion
    )
    SELECT array_agg(channel_id ORDER BY channel_id, id), array_agg(id ORDER BY channel_id, id)
    INTO channels, calls
    FROM gone
    WHERE discussion = 'channel_thread' AND channel_id IS NOT NULL;

    IF channels IS NOT NULL THEN
        WITH pending AS MATERIALIZED (
            SELECT channel_id, call_id,
                   row_number() OVER (PARTITION BY channel_id ORDER BY ordinal) AS position,
                   count(*) OVER (PARTITION BY channel_id) AS total
            FROM UNNEST(channels, calls) WITH ORDINALITY AS input(channel_id, call_id, ordinal)
            -- A channel removed in the same transaction took its history along.
            WHERE EXISTS (SELECT 1 FROM comms_channels WHERE id = input.channel_id)
        ), advanced AS (
            INSERT INTO channel_change_counters (channel_id, seq)
            SELECT channel_id, total FROM pending
            GROUP BY channel_id, total ORDER BY channel_id
            ON CONFLICT (channel_id) DO UPDATE
            SET seq = channel_change_counters.seq + EXCLUDED.seq,
                updated_at = clock_timestamp()
            RETURNING channel_id, seq
        )
        INSERT INTO channel_change_log (channel_id, seq, kind, message_id)
        SELECT pending.channel_id, advanced.seq - pending.total + pending.position,
               1, pending.call_id
        FROM pending JOIN advanced USING (channel_id)
        ORDER BY pending.channel_id, pending.position;
    END IF;
    RETURN OLD;
END;
$$;
