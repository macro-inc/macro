-- Expand step only. Currently deployed initiative writers still INSERT
-- `description` and omit this column, so `description_document_id` is nullable
-- and `description` stays. A later PR after deploy drops `description` and
-- may SET NOT NULL on the document id.
--
-- ADD VALUE is safe in the same transaction as the column add because this
-- migration never uses the new enum value.
ALTER TYPE document_sub_type_value ADD VALUE IF NOT EXISTS 'initiative_description';

ALTER TABLE initiative
    ADD COLUMN IF NOT EXISTS description_document_id TEXT
        UNIQUE
        REFERENCES "Document" (id) ON DELETE SET NULL;
