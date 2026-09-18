-- No production initiative rows exist yet, so this migration can install the
-- final shape: every initiative has a description document, and that document
-- cannot disappear while the initiative row still names it.
--
-- ADD VALUE is safe in the same transaction as the column add because this
-- migration never uses the new enum value.
ALTER TYPE document_sub_type_value ADD VALUE IF NOT EXISTS 'initiative_description';

ALTER TABLE initiative
    ADD COLUMN IF NOT EXISTS description_document_id TEXT
        NOT NULL
        UNIQUE
        REFERENCES "Document" (id) ON DELETE RESTRICT;

ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_max_length;

ALTER TABLE initiative
    DROP COLUMN IF EXISTS description;
