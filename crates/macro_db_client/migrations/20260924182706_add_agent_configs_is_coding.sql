-- Whether a persona is a coding agent is its own setting, not a property
-- of its runtime: a coding agent answers a channel mention with a magic
-- chip into its live session, a chat agent replies in the thread. Seeded
-- from the harness the way the harness used to decide it - Macro's
-- in-memory runtime chats, every other runtime codes - and required from
-- here on, so the row is the one source of truth.
ALTER TABLE agent_configs
    ADD COLUMN is_coding BOOLEAN;

UPDATE agent_configs
SET is_coding = harness NOT IN ('in-memory', 'macro-inmem');

ALTER TABLE agent_configs
    ALTER COLUMN is_coding SET NOT NULL;

COMMENT ON COLUMN agent_configs.is_coding IS
    'Whether the agent works in a repository, which decides how a channel mention is answered: a coding agent posts a magic chip into the live session, a chat agent replies in the thread. Chosen in the agent''s settings; seeded from the harness when the column was added.';
