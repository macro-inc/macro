-- Contract release #6732 is deployed in v2026.10.1.0. This PR includes the
-- final PDF threadId query fix; the user accepted old-instance PDF failures
-- during the same-release rollout. Recovery requires successful service rollout.
-- Before deployment, verify a production snapshot and external SQL-reader check
-- (see docs/comment-schema-drop.md). This PR does not authorize deployment.
SET LOCAL lock_timeout = '5s';

-- Replace the function before removing the column its old body references.
-- Document notifications use commentId; channel, initiative and CRM use
-- messageId (with message_id supported for historical metadata).
CREATE OR REPLACE FUNCTION cascade_comms_message_delete_to_notifications()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        DELETE FROM notification
        WHERE event_item_type = NEW.parent_entity_type
          AND event_item_id = NEW.parent_entity_id
          AND (
              metadata->>'messageId' = NEW.id::text
              OR metadata->>'message_id' = NEW.id::text
              OR (NEW.parent_entity_type = 'document' AND metadata->>'commentId' = NEW.id::text)
          );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER trg_sync_comms_message_parent ON comms_messages;
DROP FUNCTION sync_comms_message_parent();

-- Preserve channel referential integrity and hard-delete cascades using the
-- same generated-parent FK pattern as CRM. This stored column rewrites the
-- table; schedule the migration for a quiet window. Attachments still cascade
-- through their message FK. Existing parent timeline/history/activity indexes
-- already replace the channel indexes removed with channel_id.
ALTER TABLE comms_messages
    ADD COLUMN channel_message_parent_id uuid GENERATED ALWAYS AS (
        CASE WHEN parent_entity_type = 'channel' THEN parent_entity_id::uuid END
    ) STORED REFERENCES comms_channels (id) ON DELETE CASCADE,
    DROP COLUMN channel_id;

CREATE INDEX idx_comms_messages_channel_parent
    ON comms_messages (channel_message_parent_id)
    WHERE channel_message_parent_id IS NOT NULL;

-- DROP COLUMN also removes indexes that INCLUDE the column. Rebuild this
-- entity lookup index explicitly so reverse attachment queries keep coverage.
DROP INDEX idx_comms_attachments_entity_created;
ALTER TABLE comms_attachments DROP COLUMN channel_id;
CREATE INDEX idx_comms_attachments_entity_created
    ON comms_attachments (entity_type, entity_id, created_at DESC) INCLUDE (message_id);

-- A placeable must still belong to a discussion. Fail rather than silently
-- discard any rootless legacy placeables. Highlights may stand alone.
ALTER TABLE "PdfPlaceableCommentAnchor"
    ALTER COLUMN root_id SET NOT NULL,
    DROP COLUMN "threadId";
ALTER TABLE "PdfHighlightAnchor" DROP COLUMN "threadId";

-- Use RESTRICT (the default), not CASCADE: unknown dependents must stop the
-- migration. Keep both migrated_comment_* mapping tables for old links.
DROP TABLE "Comment";
DROP TABLE "ThreadAnchor";
DROP TABLE "Thread";
DROP TABLE crm_comment;
DROP TABLE crm_thread;
