-- Until 2026-09-11 the task-assignee grant ran a bulk user upsert whose owner
-- guard sat in the conflict target, where it only steers index inference. A
-- creator who assigned a task to themselves had their own direct row rewritten
-- from owner to edit. Document reads still report the recorded owner as owner,
-- but every reader of the grant table sees an editor. Raise those direct rows
-- back to owner. Owners with no direct row at all are older, mostly
-- folder-granted data with a different history, and are left alone.
SET LOCAL lock_timeout = '5s';

UPDATE entity_access ea
SET access_level = 'owner', updated_at = NOW()
FROM "Document" d
WHERE ea.entity_type = 'document'
  AND ea.source_type = 'user'
  AND ea.granted_from_project_id IS NULL
  AND ea.entity_id::text = d.id
  AND ea.source_id = d.owner
  AND ea.access_level <> 'owner';
