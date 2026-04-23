-- When a channel message is soft-deleted, remove any notification rows
-- whose metadata->>'messageId' points at it. user_notification rows cascade
-- via existing FK (migration 20260126170641).

CREATE OR REPLACE FUNCTION cascade_comms_message_delete_to_notifications()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        DELETE FROM notification
        WHERE event_item_type = 'channel'
          AND event_item_id = NEW.channel_id::text
          AND metadata->>'messageId' = NEW.id::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_comms_message_delete_to_notifications
AFTER UPDATE OF deleted_at ON comms_messages
FOR EACH ROW
EXECUTE FUNCTION cascade_comms_message_delete_to_notifications();

-- Backfill: sweep notifications for already-soft-deleted messages.
-- Predicates mirror the trigger: event_item_type, event_item_id, messageId.
DELETE FROM notification n
WHERE n.event_item_type = 'channel'
  AND n.metadata->>'messageId' IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM comms_messages m
      WHERE m.id::text = n.metadata->>'messageId'
        AND m.channel_id::text = n.event_item_id
        AND m.deleted_at IS NOT NULL
  );
