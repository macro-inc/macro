-- The scheduler checks unsettled runs in turn, least recently checked
-- first, so runs waiting a long time (for an approval, say) never keep it
-- from the others.
ALTER TABLE idea_run ADD COLUMN checked_at timestamptz;

DROP INDEX idea_run_unsettled_idx;
CREATE INDEX idea_run_unsettled_idx ON idea_run (checked_at NULLS FIRST, started_at)
    WHERE settled_at IS NULL;
