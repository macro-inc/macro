-- Instructions the session's harness runs under, snapshotted at creation like
-- model/harness/workspace. Immutable for the session's life: they are the
-- runtime's system prompt, and a session that changed system prompts mid-way
-- would have a conversation half its agent never agreed to.
--
-- Nullable with no default, unlike `workspace`: a session without instructions
-- is the normal case, not a row waiting to be backfilled.
ALTER TABLE agent_session
    ADD COLUMN instructions TEXT;
