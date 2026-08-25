-- Completion is per-firing for a recurring reminder, not per-series.
--
-- Marking a reminder done means "I have dealt with the firing in front of me".
-- For a one-shot that is the end of it, so a completed one never comes due
-- again. For a recurring one the series carries on — ending it is what deleting
-- is for — so `completed_at` must not remove it from the dispatcher's reach.
--
-- The old index could not serve that query: it excluded every completed row, so
-- a daily reminder someone had ticked off would fall out of the index and the
-- minutely sweep would have to scan the table to find it.
CREATE INDEX IF NOT EXISTS reminder_due_v2_idx
    ON reminder (next_run_at)
    WHERE enabled AND (cron IS NOT NULL OR completed_at IS NULL);

-- Superseded by the index above, which covers everything it did.
DROP INDEX IF EXISTS reminder_due_idx;
