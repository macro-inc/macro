-- no-transaction
-- Use PGOPTIONS='-c lock_timeout=2s' when running migrations.
CREATE INDEX CONCURRENTLY saved_view_team_created_idx ON saved_view (shared_team_id, created_at, id)
    WHERE shared_team_id IS NOT NULL;
