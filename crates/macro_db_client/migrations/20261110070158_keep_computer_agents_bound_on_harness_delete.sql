-- Deleting a Macro computer's harness no longer unbinds its agents: the
-- computer's release deletes them right after, finding them by that binding,
-- so a retried release still can. Other harnesses keep unbinding.

CREATE OR REPLACE FUNCTION unbind_agents_from_deleted_harness()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        IF NEW.computer_id IS NULL THEN
            UPDATE agent_configs SET harness_id = NULL WHERE harness_id = NEW.id;
        END IF;
        RETURN NULL;
    END;
$$;
