SET lock_timeout = '5s';

-- The directory new sessions on a runtime use when their agent names none.
-- NULL uses the workspace in the machine's macrod.toml.
ALTER TABLE harnesses ADD COLUMN workspace_path TEXT;

-- What the daemon last reported its sessions may use: its allowed roots and
-- the Git repositories under them, as [{"path": "...", "kind": "..."}].
ALTER TABLE harnesses
    ADD COLUMN reported_workspaces JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The directory this agent's new sessions use on its runtime. NULL uses the
-- runtime's workspace.
ALTER TABLE agent_configs ADD COLUMN workspace_path TEXT;

ALTER TABLE agent_configs
    ADD CONSTRAINT agent_configs_workspace_needs_harness
    CHECK (workspace_path IS NULL OR harness_id IS NOT NULL);

-- Deleting a harness unbinds its agents; their workspace goes with it, since
-- it names a directory on that harness's machine.
CREATE OR REPLACE FUNCTION unbind_agents_from_deleted_harness()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        UPDATE agent_configs
        SET harness_id = NULL, workspace_path = NULL
        WHERE harness_id = NEW.id;
        RETURN NULL;
    END;
$$;
