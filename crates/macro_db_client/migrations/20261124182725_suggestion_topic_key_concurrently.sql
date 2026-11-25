-- no-transaction
-- A topic's suggestions by state, latest change first: when one of them last
-- became done or was resolved is the first row of each, however many it has
-- had, and deleting a topic (with its person) finds the suggestions that name
-- it without scanning the person's others. If this build is interrupted it
-- leaves an INVALID index: drop it before running the migration again.
CREATE INDEX CONCURRENTLY IF NOT EXISTS suggestion_topic_key_idx
    ON suggestion (user_id, topic_key, state, state_changed_at DESC)
    WHERE topic_key IS NOT NULL;
