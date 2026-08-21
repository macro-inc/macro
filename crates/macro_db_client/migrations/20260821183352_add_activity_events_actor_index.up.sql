CREATE INDEX idx_activity_events_actor
    ON activity_events (actor_id, occurred_at DESC, id DESC);
