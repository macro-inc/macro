-- Notify notification-service when deleting notifications removes user_notification rows.
--
-- The existing FK from user_notification.notification_id to notification.id uses
-- ON DELETE CASCADE. This BEFORE DELETE trigger runs while those rows are still
-- visible, so listeners can learn which users need realtime notification-delete
-- updates before the cascade removes the rows.

CREATE OR REPLACE FUNCTION notify_user_notification_deletes()
RETURNS TRIGGER AS $$
DECLARE
    affected_user_ids JSONB;
BEGIN
    SELECT jsonb_agg(user_id)
    INTO affected_user_ids
    FROM user_notification
    WHERE notification_id = OLD.id;

    IF affected_user_ids IS NOT NULL THEN
        BEGIN
            PERFORM pg_notify(
                'notification_events',
                jsonb_build_object(
                    'type', 'user_notification_deletes',
                    'notificationId', OLD.id,
                    'userIds', affected_user_ids
                )::TEXT
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'pg_notify failed: %', SQLERRM;
        END;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_user_notification_deletes ON notification;

CREATE TRIGGER trg_notify_user_notification_deletes
BEFORE DELETE ON notification
FOR EACH ROW
EXECUTE FUNCTION notify_user_notification_deletes();
