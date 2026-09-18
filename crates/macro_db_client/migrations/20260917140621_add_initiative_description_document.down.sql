-- Postgres cannot drop an enum value. Restore the legacy description column
-- and remove the document link.
ALTER TABLE initiative
    DROP COLUMN IF EXISTS description_document_id;

ALTER TABLE initiative
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_max_length;

ALTER TABLE initiative
    ADD CONSTRAINT initiative_description_max_length
        CHECK (length(description) <= 10000);
