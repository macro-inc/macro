WITH items AS (
    SELECT d.id,
           CASE WHEN st.sub_type = 'task' THEN 'task' ELSE 'document' END AS kind,
           CASE WHEN d."deletedAt" IS NULL THEN d."updatedAt" END AS sort_ts
    FROM "Document" d
    LEFT JOIN document_sub_type st ON st.document_id = d.id
    WHERE $1 = 'document' AND d.id = ANY($2)
    UNION ALL
    SELECT c.id, 'chat', CASE WHEN c."deletedAt" IS NULL THEN c."updatedAt" END
    FROM "Chat" c WHERE $1 = 'chat' AND c.id = ANY($2)
    UNION ALL
    SELECT p.id, 'project', CASE WHEN p."deletedAt" IS NULL THEN p."updatedAt" END
    FROM "Project" p WHERE $1 = 'project' AND p.id = ANY($2)
), wanted AS (
    SELECT ea.source_id, i.id AS entity_id, i.kind, i.sort_ts, count(*)::int AS grants
    FROM items i
    JOIN entity_access ea ON ea.entity_id::text = i.id AND ea.entity_type = $1
    GROUP BY ea.source_id, i.id, i.kind, i.sort_ts
), stale AS (
    DELETE FROM source_items s
    WHERE s.entity_type = $1 AND s.entity_id = ANY($2)
      AND NOT EXISTS (
          SELECT 1 FROM wanted w WHERE w.entity_id = s.entity_id AND w.source_id = s.source_id
      )
)
INSERT INTO source_items AS s (source_id, entity_type, kind, entity_id, sort_ts, grants)
SELECT source_id, $1, kind, entity_id, sort_ts, grants FROM wanted
ON CONFLICT (entity_type, entity_id, source_id) DO UPDATE
SET kind = EXCLUDED.kind, sort_ts = EXCLUDED.sort_ts, grants = EXCLUDED.grants
WHERE (s.kind, s.sort_ts, s.grants)
      IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.sort_ts, EXCLUDED.grants)
