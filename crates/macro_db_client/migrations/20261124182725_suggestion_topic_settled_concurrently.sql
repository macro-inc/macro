-- no-transaction
-- When one of a topic's suggestions last became done or was resolved: one
-- index row per topic, however many it has had. If this build is interrupted
-- it leaves an INVALID index: drop it before running the migration again.
CREATE INDEX CONCURRENTLY IF NOT EXISTS suggestion_topic_settled_idx
    ON suggestion (user_id, topic_key, state_changed_at DESC)
    WHERE topic_key IS NOT NULL AND state IN ('done', 'resolved');
