-- What each imported item is in its source system, the row it was imported
-- under, and the review that approved it. All three columns are nullable, so
-- adding them is a catalog-only change. NULL `kind` reads as the source's
-- original kind (Linear issue, Notion page, Slack channel), which is what
-- every existing row and every row written by older code is. The check is
-- validated separately so this migration never scans the table.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_entity
    ADD COLUMN kind TEXT,
    ADD COLUMN parent_id UUID REFERENCES import_entity (id) ON DELETE CASCADE,
    ADD COLUMN review_id UUID REFERENCES agent_session_review (id) ON DELETE SET NULL;

ALTER TABLE import_entity ADD CONSTRAINT import_entity_kind_check CHECK (
    kind IS NULL
    OR (source = 'linear' AND kind IN ('issue', 'project', 'document'))
    OR (source = 'notion' AND kind IN ('page', 'database', 'data_source', 'row'))
    OR (source = 'slack' AND kind = 'channel')
) NOT VALID;
