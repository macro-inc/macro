-- Answering a request to join a calendar event retires its notification.
--
-- Only opening the event marked the notification seen, so an answer from a
-- delegate, through the API or by an agent left it listed and eligible for the
-- digest email, for a request already settled. As in
-- calendar_event_join_request_notification_cleanup, the notification is deleted
-- rather than marked, which reaches every recipient's open clients and takes it
-- out of a pending digest, and the cleanup lives on the row, where it commits
-- with the answer whichever path gave it.
--
-- The notification is keyed to the event, and an event can hold several open
-- requests, each with its own notification. The event and type find its
-- notifications by index; the request id in the metadata, which
-- CalendarEventJoinRequestMetadata writes as requestId, picks the answered one.
--
-- These notifications are queued, so one can arrive after the answer, past the
-- cleanup above, and the insert checks the request too. The lookup locks the
-- request FOR SHARE, which conflicts with the update that answers it, so it
-- waits for an answer in flight: whichever commits first, the notification does
-- not outlive the open request. The event is locked first, in the order a delete
-- reaches the two rows, so the guard cannot deadlock with the cascade. A request
-- that is gone has nothing to answer either. The trigger on notification keeps
-- its function, replaced in place, so this takes no lock on that table.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION delete_answered_join_request_notification()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        DELETE FROM notification
        WHERE event_item_type = 'calendar_event'
          AND event_item_id = NEW.event_id::text
          AND notification_event_type = 'calendar_event_join_request'
          AND metadata->>'requestId' = NEW.id::text;
        RETURN NULL;
    END;
$$;

CREATE TRIGGER calendar_event_join_request_answered_notification_cleanup
    AFTER UPDATE OF status ON calendar_event_join_requests
    FOR EACH ROW
    WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
    EXECUTE FUNCTION delete_answered_join_request_notification();

CREATE OR REPLACE FUNCTION skip_join_request_notification_without_live_event()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        PERFORM 1 FROM calendar_events
        WHERE id = NEW.event_item_id::uuid
          AND status <> 'cancelled'
        FOR SHARE;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
        PERFORM 1 FROM calendar_event_join_requests
        WHERE id = (NEW.metadata->>'requestId')::uuid
          AND status = 'pending'
        FOR SHARE;
        IF FOUND THEN
            RETURN NEW;
        END IF;
        RETURN NULL;
    END;
$$;
