-- no-transaction
-- What a person did themselves, newest first, for the activity check
-- (crates/activity, UserActivity): rows a signed-in user made directly, not
-- through a code-mode run. Without it the check read every row of the
-- person's window from idx_activity_events_subject, and someone away whose
-- agents keep working had all of them read and thrown away. Partial: bot,
-- guest and participant rows and correlated runs never answer the check.
-- The check repeats this predicate so the planner can use the index.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY idx_activity_events_own
    ON activity_events (actor_id, occurred_at DESC)
    WHERE agent_correlation_id IS NULL AND actor_id LIKE 'macro|%';
