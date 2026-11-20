-- The OFFSET 0 fence keeps this shape: look each id up on its own, through the
-- live-document index, in the order given (sorted, so the lookups walk the
-- index in order). The work is bounded by the ids, never by the Document table.
SELECT checked.id AS "id!", d.owner AS "owner!"
FROM unnest($1::uuid[]) AS checked(id)
CROSS JOIN LATERAL (
    SELECT d.owner
    FROM "Document" d
    WHERE d.id = checked.id::text
        AND d."deletedAt" IS NULL
    OFFSET 0
) d
