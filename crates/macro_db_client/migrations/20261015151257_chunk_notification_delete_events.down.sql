-- Restore the previous unchunked event publisher. This does not restore any
-- notifications deleted by the worker; retention deletion is irreversible.
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
