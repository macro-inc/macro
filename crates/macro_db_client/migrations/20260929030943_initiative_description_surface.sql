-- Initiative descriptions move from a hidden `initiative_description` Document to a
-- collab surface (collab_surfaces) parented by the initiative. Access to the surface
-- derives from access to the initiative, so new initiatives no longer need a document
-- whose grants are mirrored in lockstep.
--
-- Existing initiatives adopt their description document's sync-service session in
-- place: the surface id is the legacy document id, so the CRDT (content and history)
-- is reused as-is and nothing is copied or lost. The legacy document stays linked
-- through description_document_id, and its grants keep being mirrored, until a later
-- change retires it.
--
-- Expand phase: description_surface_id stays nullable so services still running the
-- previous release can insert rows without it. Readers fall back to the legacy
-- document id, which is the surface id by construction. A follow-up migration
-- backfills again and sets NOT NULL once every writer sets the column.
ALTER TABLE initiative
    ADD COLUMN IF NOT EXISTS description_surface_id UUID;

UPDATE initiative
SET description_surface_id = description_document_id::uuid
WHERE description_surface_id IS NULL;

-- New initiatives have no description document.
ALTER TABLE initiative
    ALTER COLUMN description_document_id DROP NOT NULL;

ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_surface_id_key;

ALTER TABLE initiative
    ADD CONSTRAINT initiative_description_surface_id_key UNIQUE (description_surface_id);

-- While a legacy document is linked, the surface is that document's session. The
-- spelling must match exactly: the sync-service session key is the document id text,
-- and a surface is addressed by its canonical uuid spelling.
ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_surface_adopts_document;

ALTER TABLE initiative
    ADD CONSTRAINT initiative_description_surface_adopts_document
        CHECK (
            description_document_id IS NULL
            OR description_surface_id IS NULL
            OR description_surface_id::text = description_document_id
        );

-- Every initiative keeps a description somewhere.
ALTER TABLE initiative
    DROP CONSTRAINT IF EXISTS initiative_description_present;

ALTER TABLE initiative
    ADD CONSTRAINT initiative_description_present
        CHECK (description_surface_id IS NOT NULL OR description_document_id IS NOT NULL);
