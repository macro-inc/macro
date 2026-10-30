-- A calendar event's join-request notifications go when the event does.
--
-- A notification about a request to join an event that has gone leads nowhere,
-- and nothing else clears it: only opening the event marks it seen. The event
-- row is deleted by sync once its last source is gone (a delete through Macro,
-- a cancellation or removal synced from Google or Outlook, a disabled calendar)
-- and by the email_links cascade when the inbox is removed, so, as with
-- calendar_event_entity_access_cleanup, the cleanup lives on the row rather
-- than on each of those paths. Outlook can also keep a cancelled meeting as a
-- row with status 'cancelled'. Calendars, previews and exports skip that row,
-- so the sharer has nowhere left to answer and the notification goes then too.
-- The row keeps its requests, as it keeps its grants, because it can come back.
-- A cancelled occurrence changes neither, so its series' requests stand.
--
-- Deleting the notification, rather than marking it, is what reaches open
-- clients (trg_notify_user_notification_deletes) and takes it out of a pending
-- digest email.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION delete_calendar_event_join_request_notifications()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        DELETE FROM notification
        WHERE event_item_type = 'calendar_event'
          AND event_item_id = OLD.id::text
          AND notification_event_type = 'calendar_event_join_request';
        RETURN NULL;
    END;
$$;

CREATE TRIGGER calendar_event_join_request_notification_cleanup
    AFTER DELETE ON calendar_events
    FOR EACH ROW EXECUTE FUNCTION delete_calendar_event_join_request_notifications();

CREATE TRIGGER calendar_event_cancelled_join_request_notification_cleanup
    AFTER UPDATE OF status ON calendar_events
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status <> 'cancelled')
    EXECUTE FUNCTION delete_calendar_event_join_request_notifications();
