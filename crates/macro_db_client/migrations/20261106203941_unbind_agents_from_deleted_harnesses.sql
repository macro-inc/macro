-- Deleting a harness unbinds the agents that ran on it.
--
-- Harnesses are soft-deleted (`deleted_at`), so `agent_configs.harness_id`'s
-- ON DELETE SET NULL never fired and agents kept pointing at a dead row:
-- every later settings change re-checked that binding and was refused with
-- "unknown harness". A soft delete now unbinds them the way a hard delete
-- does, leaving a 'macrod' agent with a null harness_id until it is rebound.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION unbind_agents_from_deleted_harness()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        UPDATE agent_configs SET harness_id = NULL WHERE harness_id = NEW.id;
        RETURN NULL;
    END;
$$;

CREATE TRIGGER harnesses_unbind_agents_on_delete
    AFTER UPDATE OF deleted_at ON harnesses
    FOR EACH ROW
    WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
    EXECUTE FUNCTION unbind_agents_from_deleted_harness();

UPDATE agent_configs
SET harness_id = NULL
FROM harnesses
WHERE harnesses.id = agent_configs.harness_id
  AND harnesses.deleted_at IS NOT NULL;
