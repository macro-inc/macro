//! Notification-service implementation of the [`ReminderNotifier`] port.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use model_notifications::ReminderMetadata;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;

use crate::domain::models::DueReminder;
use crate::domain::ports::ReminderNotifier;

/// Delivers due reminders by handing them to the notification ingress, which
/// owns everything downstream: recipient filtering, persistence, websocket,
/// push and email digest.
#[derive(Debug, Clone)]
pub struct NotificationReminderNotifier<I> {
    ingress: I,
}

impl<I> NotificationReminderNotifier<I> {
    /// Wrap a notification ingress.
    pub fn new(ingress: I) -> Self {
        Self { ingress }
    }
}

/// A delivery attempt that the notification ingress rejected.
#[derive(Debug, thiserror::Error)]
#[error("failed to send reminder notification")]
pub struct NotifyError;

impl<I: NotificationIngress> ReminderNotifier for NotificationReminderNotifier<I> {
    type Err = NotifyError;

    #[tracing::instrument(err, skip(self))]
    async fn notify(&self, due: &DueReminder) -> Result<(), Self::Err> {
        // A standalone reminder has no entity to hang the notification on, so
        // it is addressed at the user themselves — the same shape
        // `inbox_reauth_required` uses.
        let notification_entity = match due.reminder.entity() {
            Some(entity) => entity,
            None => EntityType::User.with_entity_str(due.owner_id.as_ref()),
        };

        let request = SendNotificationRequestBuilder {
            notification_entity,
            secondary_notification_entity: None,
            notification: ReminderMetadata {
                reminder_id: due.reminder.id,
                description: due.reminder.description.clone(),
            },
            // Must stay None. A recipient who is also the sender is filtered
            // out of their own notification, and a reminder's only recipient is
            // the person who set it — naming them as sender would drop the
            // notification silently.
            sender_id: None,
            recipient_ids: HashSet::from([due.owner_id.copied()]),
        }
        .into_request()
        .with_apns()
        .with_conn_gateway();

        self.ingress
            .send_notification(request)
            .await
            .map_err(|e| {
                tracing::error!(error = ?e, reminder_id = %due.reminder.id, "reminder notification rejected");
                NotifyError
            })?;

        Ok(())
    }
}
