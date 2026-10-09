-- no-transaction

-- System timelines seek a bounded page per selected action. Messages, views,
-- content edits and email sends are most of the table and never appear in a
-- timeline, so the index leaves them out and their inserts don't maintain it.
-- Keep the predicate in sync with activity's UNINDEXED_TIMELINE_ACTIONS.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_entity_action_timeline
    ON activity_events (entity_type, entity_id, action, occurred_at DESC, id DESC)
    WHERE action NOT IN ('messaged', 'opened', 'edited', 'sent');
