-- Persist the owner-only Notion mirror across import runs. Nullable columns
-- need no backfill and remain compatible with existing run readers/writers.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run
    ADD COLUMN personal_root_folder_id UUID,
    ADD COLUMN personal_folder_ids JSONB;
