-- Agent permissions: an owned agent's policy may follow another policy (its
-- source) instead of owning its settings. A follower resolves through its
-- source's chain on every call; its own rules only restrict.
--
-- `follows` with no `source_policy_id` is a follower whose source was hard
-- deleted (`ON DELETE SET NULL`): it resolves every operation to ask until
-- someone picks a source or detaches, so no check may forbid it. Only agents
-- follow; persona and team policies are roots.
--
-- The table is small and used only behind the agent permissions flag: the
-- columns have constant defaults (no rewrite), the checks scan a few rows,
-- and the indexes build in moments.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_permission_policy
    ADD COLUMN follows boolean NOT NULL DEFAULT false,
    ADD COLUMN source_policy_id uuid REFERENCES agent_permission_policy (id) ON DELETE SET NULL,
    -- A user id is an email: it must not outlive the user.
    ADD COLUMN source_set_by text REFERENCES "User" (id) ON DELETE SET NULL,
    ADD COLUMN source_set_at timestamptz,
    ADD CONSTRAINT agent_permission_policy_only_agents_follow CHECK (kind = 'agent' OR NOT follows),
    ADD CONSTRAINT agent_permission_policy_source_needs_follows CHECK (
        follows OR source_policy_id IS NULL
    ),
    ADD CONSTRAINT agent_permission_policy_not_own_source CHECK (source_policy_id IS DISTINCT FROM id);

-- A policy's followers (the follower tree's height, a source's deletes).
CREATE INDEX agent_permission_policy_source_idx ON agent_permission_policy (source_policy_id)
WHERE source_policy_id IS NOT NULL;
-- The person deletes that null `source_set_by`.
CREATE INDEX agent_permission_policy_source_set_by_idx ON agent_permission_policy (source_set_by)
WHERE source_set_by IS NOT NULL;
