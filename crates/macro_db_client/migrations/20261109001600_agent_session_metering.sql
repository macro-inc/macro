-- What an in-process session's turns are admitted and metered as, set by
-- whoever opens the session:
--   agent_session:        the owner's billable agent session usage;
--   routine_suggestions:  a routine suggestion session's, metered but never
--                         billed.
-- Replicas on older code insert without it and get `agent_session`, which is
-- what they meter every session as.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_session
    ADD COLUMN IF NOT EXISTS metering TEXT NOT NULL DEFAULT 'agent_session';
