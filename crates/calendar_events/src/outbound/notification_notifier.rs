//! Notification-service implementation of the calendar reminder notifier port.

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::CalendarEventReminderMetadata;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use rootcause::Report;

use crate::domain::models::{DueCalendarReminder, EventTime};
use crate::domain::ports::CalendarReminderNotifier;

/// Delivers due calendar reminders by handing them to the notification
/// ingress, which owns everything downstream: recipient filtering,
/// persistence, websocket, and push.
#[derive(Debug, Clone)]
pub struct NotificationCalendarReminderNotifier<I> {
    ingress: I,
}

impl<I> NotificationCalendarReminderNotifier<I> {
    /// Wrap a notification ingress.
    pub fn new(ingress: I) -> Self {
        Self { ingress }
    }
}

impl<I: NotificationIngress> CalendarReminderNotifier for NotificationCalendarReminderNotifier<I> {
    #[tracing::instrument(err, skip_all, fields(event_id = %due.firing.event_id))]
    async fn notify(&self, due: &DueCalendarReminder) -> Result<(), Report> {
        let owner_id = MacroUserIdStr::parse_from_str(&due.owner_id).map_err(|error| {
            rootcause::report!("calendar reminder owner is not a macro user id: {error}")
                .into_dynamic()
        })?;
        let (starts_at, ends_at, start_date) = match due.time {
            EventTime::Timed {
                starts_at, ends_at, ..
            } => (Some(starts_at), Some(ends_at), None),
            EventTime::AllDay { start_date, .. } => (None, None, Some(start_date)),
        };
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::CalendarEvent
                .with_entity_string(due.firing.event_id.to_string()),
            secondary_notification_entity: None,
            notification: CalendarEventReminderMetadata {
                event_id: due.firing.event_id,
                occurrence_key: due.firing.occurrence_key.clone(),
                title: due.title.clone(),
                starts_at,
                ends_at,
                start_date,
                time_zone: due.display_time_zone.clone(),
                minutes_before: due.firing.minutes_before,
            },
            // Must stay None. A recipient who is also the sender is filtered
            // out of their own notification, and a calendar reminder's only
            // recipient is the event's owner.
            sender_id: None,
            recipient_ids: HashSet::from([owner_id]),
        }
        .into_request()
        .with_apns()
        .with_conn_gateway();

        self.ingress
            .send_notification(request)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    event_id = %due.firing.event_id,
                    "calendar reminder notification rejected"
                );
                rootcause::report!("failed to send calendar reminder notification").into_dynamic()
            })?;

        Ok(())
    }
}
