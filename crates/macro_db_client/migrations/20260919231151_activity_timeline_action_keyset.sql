-- no-transaction

-- System timelines seek a bounded page per selected action, without scanning
-- the much larger volume of message/view activity for the same parent.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_entity_action_timeline
    ON activity_events (entity_type, entity_id, action, occurred_at DESC, id DESC);
