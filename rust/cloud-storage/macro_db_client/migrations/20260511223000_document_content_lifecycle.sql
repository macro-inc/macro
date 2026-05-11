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
        WHEN uploaded AND "fileType" = 'docx' THEN 'docx_bom_parts'
        WHEN uploaded AND "fileType" = 'md' THEN 'unknown'
        WHEN uploaded THEN 'object_storage'
        WHEN "fileType" = 'docx' THEN 'docx_bom_parts'
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
