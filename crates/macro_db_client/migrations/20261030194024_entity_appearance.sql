-- Nullable entity-owned presentation overrides keep deployed writers compatible.
-- Appearance writes deliberately do not change content timestamps.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Document" ADD COLUMN appearance JSONB;
ALTER TABLE initiative ADD COLUMN appearance JSONB;
ALTER TABLE database_entities ADD COLUMN appearance JSONB;
ALTER TABLE forms ADD COLUMN appearance JSONB;
ALTER TABLE scheduled_action ADD COLUMN appearance JSONB;
ALTER TABLE scheduled_action_template ADD COLUMN appearance JSONB;
