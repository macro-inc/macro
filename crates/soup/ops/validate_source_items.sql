-- Read-only parity check. Run after backfill on the primary, and again on any
-- replica used for soup. A consistent snapshot avoids reporting concurrent commits
-- as drift. A zero mismatch count is required before enabling projection reads.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH items AS (
    SELECT d.id AS entity_id, 'document' AS entity_type,
           CASE WHEN st.sub_type = 'task' THEN 'task' ELSE 'document' END AS kind,
           CASE WHEN d."deletedAt" IS NULL THEN d."updatedAt" END AS sort_ts
    FROM "Document" d
    LEFT JOIN document_sub_type st ON st.document_id = d.id
    UNION ALL
    SELECT c.id, 'chat', 'chat',
           CASE WHEN c."deletedAt" IS NULL THEN c."updatedAt" END
    FROM "Chat" c
    UNION ALL
    SELECT p.id, 'project', 'project',
           CASE WHEN p."deletedAt" IS NULL THEN p."updatedAt" END
    FROM "Project" p
), expected AS (
    SELECT ea.source_id, i.entity_type, i.kind, i.entity_id, i.sort_ts,
           count(*)::int AS grants
    FROM items i
    JOIN entity_access ea
      ON ea.entity_id::text = i.entity_id AND ea.entity_type = i.entity_type
    GROUP BY ea.source_id, i.entity_type, i.kind, i.entity_id, i.sort_ts
), missing_or_wrong AS (
    SELECT * FROM expected
    EXCEPT
    SELECT source_id, entity_type, kind, entity_id, sort_ts, grants FROM source_items
), extra_or_wrong AS (
    SELECT source_id, entity_type, kind, entity_id, sort_ts, grants FROM source_items
    EXCEPT
    SELECT * FROM expected
)
SELECT 'missing_or_wrong' AS mismatch, count(*) FROM missing_or_wrong
UNION ALL
SELECT 'extra_or_wrong', count(*) FROM extra_or_wrong;

COMMIT;
