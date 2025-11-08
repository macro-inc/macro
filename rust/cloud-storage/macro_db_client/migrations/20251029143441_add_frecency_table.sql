-- Create the frecency_events table
CREATE TABLE frecency_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    connection_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    was_processed BOOLEAN NOT NULL DEFAULT false
);

-- Create indexes for efficient querying
CREATE INDEX idx_frecency_events_user_id ON frecency_events(user_id);

-- Index for processing unprocessed events
CREATE INDEX idx_frecency_events_unprocessed ON frecency_events(was_processed) WHERE was_processed = false;

-- Create the frecency_aggregates table
CREATE TABLE frecency_aggregates (
    id BIGSERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    frecency_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    first_event TIMESTAMP WITH TIME ZONE NOT NULL,
    recent_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Ensure unique combination of user and entity
    CONSTRAINT unique_user_entity UNIQUE (user_id, entity_type, entity_id)
);

-- Create indexes for efficient querying of aggregates
CREATE INDEX idx_frecency_aggregates_entity ON frecency_aggregates(user_id, entity_type, entity_id);

-- Composite index for user-specific frecency lookups sorted by score
CREATE INDEX idx_frecency_aggregates_user_score ON frecency_aggregates(user_id, frecency_score DESC);
