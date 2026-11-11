-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS activity_events_agent_correlation_idx
    ON activity_events(agent_correlation_id, occurred_at DESC, id DESC)
    WHERE agent_correlation_id IS NOT NULL;
