-- no-transaction
-- Use PGOPTIONS='-c lock_timeout=2s' when running migrations.
CREATE INDEX CONCURRENTLY saved_view_owner_created_idx ON saved_view (user_id, created_at, id);
