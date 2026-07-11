-- The call-started notification type was normalized to snake_case
-- (`call_started`) so it matches every other notification type and the
-- `define_notif_event!` invariant (TYPE_NAME == snake_case of the NotifEvent
-- variant). Rewrite persisted rows so stored notifications and per-type
-- preferences keep working under the new tag.
--
-- The `NotifEvent::CallStarted` variant also carries a
-- `#[serde(alias = "call-started")]`, so rows written during the deploy
-- window still deserialize even before this migration runs.
UPDATE notification
SET notification_event_type = 'call_started'
WHERE notification_event_type = 'call-started';

UPDATE user_notification_type_preference
SET notification_event_type = 'call_started'
WHERE notification_event_type = 'call-started';
