-- Project (initiative) descriptions move to a collab surface parented by the
-- initiative, whose id is the initiative's own id and whose access derives from
-- initiative access. Description documents are no longer created or referenced;
-- existing ones stay behind unreferenced and keep their initiative_description
-- sub type, so document lists still hide them.
ALTER TABLE initiative
    DROP COLUMN IF EXISTS description_document_id;
