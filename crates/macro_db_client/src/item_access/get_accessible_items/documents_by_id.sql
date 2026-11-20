-- Each id is looked up on its own behind OFFSET 0 fences, in the order given
-- (sorted, so the lookups walk the indexes in order): through the
-- live-document index, and through the trashed-document index for the rest.
-- The work is bounded by the ids, never by the Document table.
SELECT checked.id AS "id!", COALESCE(live.owner, trashed.owner) AS "owner!"
FROM unnest($1::uuid[]) AS checked(id)
LEFT JOIN LATERAL (
    SELECT d.owner
    FROM "Document" d
    WHERE d.id = checked.id::text
        AND d."deletedAt" IS NULL
    OFFSET 0
) live ON true
LEFT JOIN LATERAL (
    SELECT d.owner
    FROM "Document" d
    WHERE d.id = checked.id::text
        AND d."deletedAt" IS NOT NULL
    OFFSET 0
) trashed ON true
WHERE live.owner IS NOT NULL
    OR trashed.owner IS NOT NULL
