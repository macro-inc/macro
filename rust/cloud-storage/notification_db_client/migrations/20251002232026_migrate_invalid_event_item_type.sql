-- Add migration script here
-- Migration to update non-EntityType enumerated event_item_type values to 'document'
-- Valid EntityType values: user, chat, channel, document, project, email, team

BEGIN;

CREATE TEMP TABLE invalid_event_item_types AS
SELECT DISTINCT event_item_type
FROM notification
WHERE event_item_type NOT IN ('user', 'chat', 'channel', 'document', 'project', 'email', 'team');

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT * FROM invalid_event_item_types
    LOOP
        RAISE NOTICE 'Will update event_item_type: % to document', rec.event_item_type;
    END LOOP;
END $$;

UPDATE notification
SET event_item_type = 'document'
WHERE event_item_type NOT IN ('user', 'chat', 'channel', 'document', 'project', 'email', 'team');

UPDATE notification
SET metadata = jsonb_set(
    metadata,
    '{itemType}',
    '"document"'::jsonb
)
WHERE metadata ? 'itemType'
  AND metadata->>'itemType' NOT IN ('user', 'chat', 'channel', 'document', 'project', 'email', 'team');

DROP TABLE invalid_event_item_types;

COMMIT;
