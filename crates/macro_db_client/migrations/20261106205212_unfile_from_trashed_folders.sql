-- Trashing a folder now returns its databases and forms to the root, as
-- purging it already did. Return the ones filed in an already trashed folder
-- too. An item in one folder inherits grants only from that folder
-- and the folders above it, so every inherited grant goes with the link.
DELETE FROM entity_access AS access
USING database_entities AS database, "Project" AS folder
WHERE access.entity_type = 'database'
  AND access.entity_id = database.database_id
  AND access.granted_from_project_id IS NOT NULL
  AND folder.id = database.project_id
  AND folder."deletedAt" IS NOT NULL;

DELETE FROM entity_access AS access
USING forms AS form, "Project" AS folder
WHERE access.entity_type = 'form'
  AND access.entity_id = form.id
  AND access.granted_from_project_id IS NOT NULL
  AND folder.id = form.project_id
  AND folder."deletedAt" IS NOT NULL;

UPDATE database_entities AS database
SET project_id = NULL, updated_at = now()
FROM "Project" AS folder
WHERE folder.id = database.project_id AND folder."deletedAt" IS NOT NULL;

UPDATE forms AS form
SET project_id = NULL, updated_at = now()
FROM "Project" AS folder
WHERE folder.id = form.project_id AND folder."deletedAt" IS NOT NULL;
