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
--
-- These notifications are queued, and a backlog can deliver one minutes after
-- its event went, past the cleanup above, so the insert checks the event too.
-- The lookup locks the row FOR SHARE, which also conflicts with a status
-- update, so it waits for a delete or cancellation in flight: whichever commits
-- first, the notification does not outlive the event. Returning NULL skips the
-- insert, which notification ingress reads as nothing to deliver.

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

CREATE FUNCTION skip_join_request_notification_without_live_event()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        PERFORM 1 FROM calendar_events
        WHERE id = NEW.event_item_id::uuid
          AND status <> 'cancelled'
        FOR SHARE;
        IF FOUND THEN
            RETURN NEW;
        END IF;
        RETURN NULL;
    END;
$$;

CREATE TRIGGER calendar_event_join_request_notification_guard
    BEFORE INSERT ON notification
    FOR EACH ROW
    WHEN (NEW.notification_event_type = 'calendar_event_join_request')
    EXECUTE FUNCTION skip_join_request_notification_without_live_event();
