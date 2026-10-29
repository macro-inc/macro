-- A calendar event's access grants go with its row, as a form's, a CRM
-- pipeline's and a call's do.
--
-- Sharing an event into a channel writes an entity_access row naming that
-- event. The row is deleted by sync once its last source is gone (a delete
-- through Macro, a cancellation or removal synced from Google or Outlook, a
-- disabled calendar) and by the email_links cascade when the inbox is
-- removed, so the cleanup lives on the row rather than on each of those
-- paths. Ids are never reused, so a grant on a deleted row can never be read
-- again. A cancelled or hidden event keeps its grants: readers already skip
-- them, and the row can come back.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION delete_calendar_event_entity_access()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        DELETE FROM entity_access WHERE entity_type = 'calendar_event' AND entity_id = OLD.id;
        RETURN NULL;
    END;
$$;

CREATE TRIGGER calendar_event_entity_access_cleanup
    AFTER DELETE ON calendar_events
    FOR EACH ROW EXECUTE FUNCTION delete_calendar_event_entity_access();
