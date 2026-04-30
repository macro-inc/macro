-- Rename ChatAttachment columns from attachmentType/attachmentId to entity_type/entity_id,
-- convert legacy attachment type values to EntityType values,
-- and cast entity_id to UUID.

BEGIN;

-- Add new columns
ALTER TABLE "ChatAttachment"
    ADD COLUMN "entity_type" TEXT,
    ADD COLUMN "entity_id" UUID;

-- Drop rows with invalid UUIDs
DELETE FROM "ChatAttachment"
WHERE "attachmentId" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Migrate data: map old attachmentType values to EntityType values, cast id to UUID
UPDATE "ChatAttachment"
SET
    "entity_type" = CASE "attachmentType"
        WHEN 'document' THEN 'document'
        WHEN 'image'    THEN 'static_file'
        WHEN 'channel'  THEN 'channel'
        WHEN 'email'    THEN 'email_thread'
        WHEN 'project'  THEN 'project'
        ELSE 'document'
    END,
    "entity_id" = "attachmentId"::UUID;

-- Make new columns non-nullable now that data is populated
ALTER TABLE "ChatAttachment"
    ALTER COLUMN "entity_type" SET NOT NULL,
    ALTER COLUMN "entity_id" SET NOT NULL;

-- Rename old columns instead of dropping, make nullable for new inserts
ALTER TABLE "ChatAttachment"
    RENAME COLUMN "attachmentType" TO "old_attachmentType";
ALTER TABLE "ChatAttachment"
    RENAME COLUMN "attachmentId" TO "old_attachmentId";
ALTER TABLE "ChatAttachment"
    ALTER COLUMN "old_attachmentType" DROP NOT NULL;
ALTER TABLE "ChatAttachment"
    ALTER COLUMN "old_attachmentId" DROP NOT NULL;

-- Drop old index (references removed columns)
DROP INDEX IF EXISTS "ChatAttachment_attachmentType_attachmentId_idx";

-- Create new index on entity columns
CREATE INDEX "ChatAttachment_entity_type_entity_id_idx"
    ON "ChatAttachment" ("entity_type", "entity_id");

COMMIT;
