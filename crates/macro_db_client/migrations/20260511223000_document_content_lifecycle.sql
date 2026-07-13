-- Markdown rows are initialized to `unknown` when already uploaded because the
-- authoritative location requires checking sync-service. Run the custom
-- dry-run/apply script after this schema migration:
-- cargo run -p document_storage_service --bin backfill_markdown_content_location -- --apply

ALTER TABLE "Document"
    ADD COLUMN "contentState" TEXT,
    ADD COLUMN "contentLocation" TEXT;

UPDATE "Document"
SET
    "contentState" = CASE
        WHEN uploaded THEN 'ready'
        ELSE 'pending'
    END,
    "contentLocation" = CASE
        WHEN uploaded AND "fileType" = 'docx' THEN 'converted_pdf'
        WHEN uploaded AND "fileType" = 'md' THEN 'unknown'
        WHEN uploaded THEN 'object_storage'
        WHEN "fileType" = 'docx' THEN 'converted_pdf'
        ELSE 'object_storage'
    END;

ALTER TABLE "Document"
    ALTER COLUMN "contentState" SET DEFAULT 'pending',
    ALTER COLUMN "contentState" SET NOT NULL,
    ADD CONSTRAINT "Document_contentState_check"
        CHECK ("contentState" IN ('unknown', 'pending', 'ready')),
    ADD CONSTRAINT "Document_contentLocation_check"
        CHECK (
            "contentLocation" IS NULL OR
            "contentLocation" IN (
                'object_storage',
                'sync_service',
                'docx_bom_parts',
                'converted_pdf',
                'unknown'
            )
        );
