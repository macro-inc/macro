-- Project (initiative) descriptions move onto a collab surface (collab_surfaces)
-- parented by the initiative, whose access derives from initiative access. The surface
-- adopts the description document's existing sync-service session in place: the
-- surface id is the document id, so content and history carry over and nothing is
-- copied.
--
-- This release still creates a description document for every initiative and keeps
-- mirroring its grants, so description_document_id stays NOT NULL and every row stays
-- readable by services still running the previous release. Readers in this release
-- tolerate a NULL document, so a follow-up can stop creating documents after this one
-- is fully deployed.
ALTER TABLE initiative
    ADD COLUMN IF NOT EXISTS description_surface_id UUID;

-- The previous release (rolling deploys, rollbacks) inserts rows without a surface.
-- Name its document's session, as for every other row, so the column is never NULL.
CREATE OR REPLACE FUNCTION initiative_default_description_surface()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.description_surface_id IS NULL THEN
        NEW.description_surface_id := NEW.description_document_id::uuid;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initiative_default_description_surface ON initiative;

CREATE TRIGGER initiative_default_description_surface
    BEFORE INSERT ON initiative
    FOR EACH ROW
    EXECUTE FUNCTION initiative_default_description_surface();

UPDATE initiative
SET description_surface_id = description_document_id::uuid
WHERE description_surface_id IS NULL;

ALTER TABLE initiative
    ALTER COLUMN description_surface_id SET NOT NULL;

ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_surface_id_key;

ALTER TABLE initiative
    ADD CONSTRAINT initiative_description_surface_id_key UNIQUE (description_surface_id);

-- While a document is linked, the surface is that document's session. Compared as
-- uuids, so any spelling of a document id satisfies it.
ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_surface_adopts_document;

ALTER TABLE initiative
    ADD CONSTRAINT initiative_description_surface_adopts_document
        CHECK (
            description_document_id IS NULL
            OR description_surface_id = description_document_id::uuid
        );
