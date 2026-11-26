-- no-transaction
-- The changes a person made themselves, newest first, for the activity
-- check (crates/activity, UserActivity): rows a signed-in user made
-- directly, not through a code-mode run, that change something (views and
-- appearance changes, NON_TOUCH_ACTION_TAGS, are left out). The check reads
-- one entry: the person's newest. Without it the check read every row of
-- the person's window from idx_activity_events_subject, and someone away
-- whose agents keep working, or who only reads, had all of them read and
-- thrown away. Bot, guest and participant rows, correlated runs and views
-- never answer the check, so they are not in it. The check repeats this
-- predicate word for word so the planner can use the index.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY idx_activity_events_own
    ON activity_events (actor_id, occurred_at DESC)
    WHERE agent_correlation_id IS NULL
      AND actor_id LIKE 'macro|%'
      AND action NOT IN ('opened', 'appearance_changed');
