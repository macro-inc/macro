-- A join request's notification goes when the request does.
--
-- Deleting the requester's account cascades their requests away and left each
-- one's notification behind: the sharer kept a row, eligible for the digest
-- email, about a request the event no longer lists. As in
-- calendar_event_join_request_answer_notification_cleanup, the cleanup lives on
-- the request row, picks the notification by the requestId in its metadata,
-- since an event can hold several open requests, and deletes rather than marks,
-- which reaches every recipient's open clients and takes it out of a pending
-- digest.
--
-- No code deletes a request; two cascades do. Deleting the event reaches this
-- row too, inside the transaction where
-- calendar_event_join_request_notification_cleanup deletes the same
-- notifications. Whichever runs first leaves nothing for the other, so each
-- notification is deleted and published once.
--
-- This changes no lock order. The trigger runs once the delete holds the request
-- and locks only notification rows, which the insert guard never waits on: the
-- guard takes the event and then the request, as an event delete does, and an
-- account delete takes the request alone, because a requester never owns the
-- event they ask to join. A queued insert behind the delete finds no request and
-- is skipped. A delete behind a queued insert waits for it to commit, then finds
-- the row it stored. The function reads notification only when it runs, so this
-- locks nothing but the small request table.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION delete_removed_join_request_notification()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        DELETE FROM notification
        WHERE event_item_type = 'calendar_event'
          AND event_item_id = OLD.event_id::text
          AND notification_event_type = 'calendar_event_join_request'
          AND metadata->>'requestId' = OLD.id::text;
        RETURN NULL;
    END;
$$;

CREATE TRIGGER calendar_event_join_request_removed_notification_cleanup
    AFTER DELETE ON calendar_event_join_requests
    FOR EACH ROW EXECUTE FUNCTION delete_removed_join_request_notification();
