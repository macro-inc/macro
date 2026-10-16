-- Preserve the existing event shape while keeping every NOTIFY payload under
-- PostgreSQL's 8000-byte limit. Bulk retention must not silently lose updates
-- for notifications addressed to many users. No history is deleted here.
CREATE OR REPLACE FUNCTION notify_user_notification_deletes()
RETURNS TRIGGER AS $$
DECLARE
    recipient TEXT;
    affected_user_ids JSONB := '[]'::JSONB;
    recipient_json JSONB;
BEGIN
    FOR recipient IN
        SELECT user_id FROM user_notification WHERE notification_id = OLD.id
    LOOP
        recipient_json := jsonb_build_array(recipient);
        -- Leave ample room for the fixed event envelope (type and UUID).
        IF octet_length(recipient_json::TEXT) > 7000 THEN
            RAISE WARNING 'notification delete recipient exceeds NOTIFY payload budget';
            CONTINUE;
        END IF;

        IF octet_length((affected_user_ids || recipient_json)::TEXT) > 7000 THEN
            BEGIN
                PERFORM pg_notify('notification_events', jsonb_build_object(
                    'type', 'user_notification_deletes',
                    'notificationId', OLD.id,
                    'userIds', affected_user_ids
                )::TEXT);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'pg_notify failed: %', SQLERRM;
            END;
            affected_user_ids := '[]'::JSONB;
        END IF;
        affected_user_ids := affected_user_ids || recipient_json;
    END LOOP;

    IF jsonb_array_length(affected_user_ids) > 0 THEN
        BEGIN
            PERFORM pg_notify('notification_events', jsonb_build_object(
                'type', 'user_notification_deletes',
                'notificationId', OLD.id,
                'userIds', affected_user_ids
            )::TEXT);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'pg_notify failed: %', SQLERRM;
        END;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
