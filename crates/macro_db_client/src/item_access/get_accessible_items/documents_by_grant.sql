-- Every subquery ends in OFFSET 0 so the planner keeps this shape: read the
-- caller's grants by source, then look each granted document up by id. The
-- work is bounded by the grants the caller holds, never by the Document table.
--
-- The innermost fence keeps the DISTINCT and the sort from being answered by
-- walking an entity-ordered index over all of entity_access. Sorting the ids
-- makes the lookups walk the document index in order.
SELECT d.id AS "id!"
FROM (
    SELECT DISTINCT held.entity_id
    FROM (
        SELECT ea.entity_id
        FROM entity_access ea
        WHERE ea.source_id = ANY($2)
            AND ea.entity_type = 'document'
        OFFSET 0
    ) held
    ORDER BY held.entity_id
    OFFSET 0
) granted
CROSS JOIN LATERAL (
    SELECT d.id
    FROM "Document" d
    WHERE d.id = granted.entity_id::text
        AND d."deletedAt" IS NULL
        AND (NOT $3 OR d.owner != $1)
    OFFSET 0
) d
