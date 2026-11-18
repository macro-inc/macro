-- Whether an in-process session's turns are billed to its owner, set by
-- whoever opens the session:
--   billable:      billed as the owner's agent session usage;
--   non_billable:  recorded, never billed.
-- Replicas on older code insert without it and get `billable`, which is how
-- they bill every session.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_session
    ADD COLUMN IF NOT EXISTS billing TEXT NOT NULL DEFAULT 'billable';
