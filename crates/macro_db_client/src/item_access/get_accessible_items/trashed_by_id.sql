-- Each id is looked up on its own behind an OFFSET 0 fence through the
-- trashed-document index, which holds only trashed rows: a live document's
-- lookup reads none of the Document table or its live-document index.
SELECT checked.id AS "id!"
FROM unnest($1::uuid[]) AS checked(id)
CROSS JOIN LATERAL (
    SELECT 1
    FROM "Document" d
    WHERE d.id = checked.id::text
        AND d."deletedAt" IS NOT NULL
    OFFSET 0
) trashed
