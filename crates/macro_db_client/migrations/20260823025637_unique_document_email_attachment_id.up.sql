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
