ALTER TABLE webhook RENAME COLUMN rule TO filters;

UPDATE webhook
SET filters = jsonb_build_array(filters)
WHERE jsonb_typeof(filters) = 'object';

ALTER TABLE webhook
ADD CONSTRAINT webhook_filters_is_array CHECK (jsonb_typeof(filters) = 'array');

DROP INDEX IF EXISTS webhook_events_gin_idx;

-- Canonical index-backed filter queries:
-- filters @> '[{"events": ["<event>"]}]'
-- filters @> '[{"ids": ["<id>"]}]'
-- filters @> '[{"events": ["<event>"], "ids": ["<id>"]}]'
CREATE INDEX webhook_filters_gin_idx
ON webhook USING GIN (filters jsonb_path_ops);
