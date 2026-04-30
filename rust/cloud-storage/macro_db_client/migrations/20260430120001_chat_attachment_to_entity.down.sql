-- Revert entity_type/entity_id back to attachmentType/attachmentId.

BEGIN;

-- Restore NOT NULL on old columns
ALTER TABLE "ChatAttachment"
    ALTER COLUMN "old_attachmentType" SET NOT NULL;
ALTER TABLE "ChatAttachment"
    ALTER COLUMN "old_attachmentId" SET NOT NULL;

-- Rename old columns back
ALTER TABLE "ChatAttachment"
    RENAME COLUMN "old_attachmentType" TO "attachmentType";
ALTER TABLE "ChatAttachment"
    RENAME COLUMN "old_attachmentId" TO "attachmentId";

-- Drop new columns
ALTER TABLE "ChatAttachment"
    DROP COLUMN "entity_type",
    DROP COLUMN "entity_id";

-- Drop new index
DROP INDEX IF EXISTS "ChatAttachment_entity_type_entity_id_idx";

-- Restore old index
CREATE INDEX "ChatAttachment_attachmentType_attachmentId_idx"
    ON "ChatAttachment" ("attachmentType", "attachmentId");

COMMIT;
