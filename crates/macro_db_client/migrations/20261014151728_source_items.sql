-- Rebuildable listing projection. Application writers maintain this table in
-- the same transaction as item and grant mutations; there are no maintenance
-- triggers. Backfill after every writer has deployed, before enabling reads.
SET LOCAL lock_timeout = '5s';

CREATE TABLE source_items (
    source_id text NOT NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('document', 'chat', 'project')),
    kind text NOT NULL CHECK (kind IN ('document', 'task', 'chat', 'project')),
    entity_id text NOT NULL,
    sort_ts timestamp(3),
    grants int NOT NULL CHECK (grants > 0),
    PRIMARY KEY (entity_type, entity_id, source_id)
);

CREATE INDEX source_items_read
    ON source_items (source_id, kind, sort_ts DESC, entity_id DESC)
    WHERE sort_ts IS NOT NULL;
