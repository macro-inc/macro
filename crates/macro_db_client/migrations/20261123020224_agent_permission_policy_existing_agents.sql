-- Agent permissions: from now on a new owned agent's policy follows its
-- scope's default (a private agent its owner's Macro policy, a team's agent
-- its team's default) when it is first used. Every owned agent that exists
-- now gets a policy of its own first, owning its settings (none, or the ones
-- already saved), so nothing it does changes.
--
-- One row per owned bot that has no policy yet; idempotent. The insert
-- checks each bot's key (a `FOR KEY SHARE` lock, which blocks only a delete
-- or a key change of that bot until the migration commits).
SET LOCAL lock_timeout = '5s';

-- Backfill (agent_permissions' pg tests re-run everything from here).

-- Migration-local UUIDv7 generation for PostgreSQL 14 (uuidv7() needs PG18);
-- policies created later get their ids from the application.
CREATE FUNCTION pg_temp.policy_uuid() RETURNS uuid LANGUAGE sql VOLATILE AS $$
    SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
        8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid
    FROM (SELECT overlay(gen_random_bytes(16) placing
        decode(lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0'), 'hex')
        FROM 1 FOR 6) AS bytes) random;
$$;

INSERT INTO agent_permission_policy (id, kind, bot_id)
SELECT pg_temp.policy_uuid(), 'agent', bots.id
FROM bots
WHERE bots.kind = 'owned'
ON CONFLICT DO NOTHING;

DROP FUNCTION pg_temp.policy_uuid();
