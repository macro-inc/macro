CREATE TABLE IF NOT EXISTS active_streams (
    entity_id TEXT NOT NULL,
    stream_key TEXT NOT NULL,
    PRIMARY KEY (entity_id, stream_key)
);
