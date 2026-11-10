-- Validated apart from 20261108190000_runtime_workspaces so the scan holds
-- only a SHARE UPDATE EXCLUSIVE lock, not that migration's exclusive one.
SET lock_timeout = '5s';

ALTER TABLE agent_configs
    VALIDATE CONSTRAINT agent_configs_workspace_needs_harness;
