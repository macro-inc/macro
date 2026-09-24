//! Notification-service implementations of the calendar reminder and join
//! request notifier ports.

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{CalendarEventJoinRequestMetadata, CalendarEventReminderMetadata};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use rootcause::Report;

use crate::domain::models::{CalendarJoinRequest, DueCalendarReminder, EventTime};
use crate::domain::ports::{CalendarJoinRequestNotifier, CalendarReminderNotifier};

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

/// Tells an event's owner about a join request through the notification
/// ingress. The requester is the sender, so the owner sees who asked.
#[derive(Debug, Clone)]
pub struct NotificationCalendarJoinRequestNotifier<I> {
    ingress: I,
}

impl<I> NotificationCalendarJoinRequestNotifier<I> {
    /// Wrap a notification ingress.
    pub fn new(ingress: I) -> Self {
        Self { ingress }
    }
}

impl<I: NotificationIngress> CalendarJoinRequestNotifier
    for NotificationCalendarJoinRequestNotifier<I>
{
    #[tracing::instrument(skip_all, fields(event_id = %request.event_id, request_id = %request.id))]
    async fn notify_join_request(
        &self,
        owner_id: &str,
        request: &CalendarJoinRequest,
        event_title: &str,
    ) {
        let (Ok(owner), Ok(requester)) = (
            MacroUserIdStr::parse_from_str(owner_id),
            MacroUserIdStr::parse_from_str(&request.requester_id),
        ) else {
            tracing::error!("calendar join request parties are not macro user ids");
            return;
        };
        let notification = SendNotificationRequestBuilder {
            notification_entity: EntityType::CalendarEvent
                .with_entity_string(request.event_id.to_string()),
            secondary_notification_entity: None,
            notification: CalendarEventJoinRequestMetadata {
                event_id: request.event_id,
                request_id: request.id,
                title: event_title.to_string(),
                requester_email: request.requester_email.clone(),
            },
            sender_id: Some(requester),
            recipient_ids: HashSet::from([owner]),
        }
        .into_request()
        .with_apns()
        .with_conn_gateway();
        if let Err(error) = self.ingress.send_notification(notification).await {
            tracing::error!(error = ?error, "calendar join request notification rejected");
        }
    }
}
