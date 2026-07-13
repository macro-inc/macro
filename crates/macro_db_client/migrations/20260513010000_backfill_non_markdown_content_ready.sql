-- Historical non-markdown documents should remain readable even when the
-- legacy `uploaded` boolean is stale. Old S3 ObjectCreated events will not
-- replay, so backfill existing non-markdown lifecycle rows optimistically to
-- ready while preserving their canonical content location.
--
-- Markdown remains excluded because its canonical sync-service location must be
-- verified by the dedicated markdown backfill/fallback workflow.

UPDATE "Document"
SET
    "contentState" = 'ready',
    "contentLocation" = CASE
        WHEN "fileType" = 'docx' THEN 'converted_pdf'
        ELSE 'object_storage'
    END
WHERE "fileType" IS DISTINCT FROM 'md'
  AND (
      "contentState" IS DISTINCT FROM 'ready'
      OR "contentLocation" IS DISTINCT FROM CASE
          WHEN "fileType" = 'docx' THEN 'converted_pdf'
          ELSE 'object_storage'
      END
  );
