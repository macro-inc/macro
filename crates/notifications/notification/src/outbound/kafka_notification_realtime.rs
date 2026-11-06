//! Kafka adapter for notification status update publication.

#[cfg(test)]
mod test;

use std::borrow::Cow;

use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike as _;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;

use crate::domain::models::websocket_notification_event::NotificationMacroEvent;
use crate::domain::models::{NotificationStatusPayload, PatchDelete};
use crate::domain::ports::NotificationRealtimePublisher;

/// Kafka-backed notification realtime publisher.
///
/// Each call publishes one typed status update event on the `macro.notifications` topic.
pub struct KafkaNotificationRealtimePublisher<B> {
    broker: B,
}

impl<B> KafkaNotificationRealtimePublisher<B> {
    /// Creates a notification realtime publisher backed by `broker`.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> NotificationRealtimePublisher for KafkaNotificationRealtimePublisher<B> {
    #[tracing::instrument(err, skip_all, fields(topic = "macro.notifications"))]
    async fn publish_updates(&self, payload: &NotificationStatusPayload<'_>) -> Result<(), Report> {
        let event = match payload {
            NotificationStatusPayload::NotificationForUsers { users, update } => {
                NotificationMacroEvent::status_updated_for_users(
                    users.iter().map(|user| user.copied()).collect(),
                    update.clone(),
                )
            }
            NotificationStatusPayload::UserNotifications { user, updates } => {
                NotificationMacroEvent::statuses_updated_for_user(
                    user.copied(),
                    updates.iter().map(borrow_update).collect(),
                )
            }
        };

        let publish = self
            .broker
            .send_event(&event)
            .context("failed to dispatch notification status update Kafka event")?;
        publish
            .await
            .context("notification status update Kafka publish task failed")?
            .context("failed to publish notification status update to Kafka")?;

        Ok(())
    }
}

fn borrow_update<'a>(
    update: &'a PatchDelete<
        uuid::Uuid,
        Cow<'_, crate::domain::models::UserNotificationRow<serde_json::Value>>,
    >,
) -> PatchDelete<uuid::Uuid, Cow<'a, crate::domain::models::UserNotificationRow<serde_json::Value>>>
{
    match update {
        PatchDelete::Patch { diff } => PatchDelete::Patch {
            diff: Cow::Borrowed(diff.as_ref()),
        },
        PatchDelete::Delete { id } => PatchDelete::Delete { id: *id },
    }
}
