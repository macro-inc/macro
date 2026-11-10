-- A deleted channel's notifications must not come back.
--
-- PgChannelsRepo::delete_channel deletes a channel's notifications with the
-- channel, since nothing else could clear them: only opening the channel marks
-- them seen. Channel notifications are queued, though, and a backlog can create
-- one after the channel went. So the delete leaves a permanent tombstone, and
-- the insert of a notification about a tombstoned channel is skipped. Returning
-- NULL skips the insert, which notification ingress reads as nothing to deliver.
--
-- The delete holds the exclusive advisory lock 'channel_notifications:<id>'
-- across its transaction and the insert takes it shared, so whichever commits
-- first, the notification does not outlive the channel. The tombstone is keyed
-- by the text `notification.event_item_id`, so the guard needs no cast.

SET LOCAL lock_timeout = '5s';

CREATE TABLE channel_notification_tombstone (
    channel_id text PRIMARY KEY,
    deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION skip_notification_for_deleted_channel()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        PERFORM pg_advisory_xact_lock_shared(
            hashtextextended('channel_notifications:' || NEW.event_item_id, 0)
        );
        IF EXISTS (
            SELECT 1 FROM channel_notification_tombstone
            WHERE channel_id = NEW.event_item_id
        ) THEN
            RETURN NULL;
        END IF;
        RETURN NEW;
    END;
$$;

CREATE TRIGGER channel_notification_guard
    BEFORE INSERT ON notification
    FOR EACH ROW
    WHEN (NEW.event_item_type = 'channel')
    EXECUTE FUNCTION skip_notification_for_deleted_channel();
