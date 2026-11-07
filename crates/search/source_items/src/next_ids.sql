WITH canonical AS (
    (SELECT id FROM "Document" WHERE $1 = 'document' AND id > $2 ORDER BY id LIMIT $3)
    UNION ALL
    (SELECT id FROM "Chat" WHERE $1 = 'chat' AND id > $2 ORDER BY id LIMIT $3)
    UNION ALL
    (SELECT id FROM "Project" WHERE $1 = 'project' AND id > $2 ORDER BY id LIMIT $3)
), projected AS (
    SELECT DISTINCT entity_id
    FROM source_items
    WHERE entity_type = $1 AND entity_id > $2
    ORDER BY entity_id
    LIMIT $3
)
SELECT id AS "id!"
FROM (SELECT id FROM canonical UNION SELECT entity_id FROM projected) candidates
ORDER BY id
LIMIT $3
