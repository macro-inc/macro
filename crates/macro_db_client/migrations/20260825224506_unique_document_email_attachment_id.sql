-- Extra document_email rows for the same email_attachment_id are leftover
-- links from same-attachment create races. This deletes those extra links
-- only. It does not delete Document rows. Keep a live document first, then
-- the smallest document_id, so the unique index can be created.
DELETE FROM document_email de
WHERE de.ctid IN (
    SELECT ranked.ctid
    FROM (
        SELECT
            de.ctid,
            ROW_NUMBER() OVER (
                PARTITION BY de.email_attachment_id
                ORDER BY
                    CASE WHEN d.id IS NOT NULL AND d."deletedAt" IS NULL THEN 0 ELSE 1 END,
                    de.document_id
            ) AS rn
        FROM document_email de
        LEFT JOIN "Document" d ON d.id = de.document_id
    ) ranked
    WHERE ranked.rn > 1
);

DROP INDEX IF EXISTS idx_document_email_attachment_id;

CREATE UNIQUE INDEX document_email_attachment_id_uq
    ON document_email (email_attachment_id);
