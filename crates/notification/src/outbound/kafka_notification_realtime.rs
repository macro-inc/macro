//! Kafka adapter for notification status update publication.

#[cfg(test)]
mod test;

use std::borrow::Cow;

use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike as _;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;

use crate::domain::models::websocket_notification_event::NotificationMacroEvent;
use crate::domain::models::{PatchDelete, UserNotificationStatusUpdate};
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
    #[tracing::instrument(
        err,
        skip_all,
        fields(update_count = updates.len(), topic = "macro.notifications")
    )]
    async fn publish_updates(
        &self,
        updates: &[UserNotificationStatusUpdate<'_>],
    ) -> Result<(), Report> {
        let Some(first) = updates.first() else {
            return Ok(());
        };

        // Callers either publish one user's update, or repeat one update for several users.
        let users = updates.iter().map(|update| update.user.copied()).collect();
        let notification_updates = first
            .update
            .updates
            .iter()
            .map(|update| match update {
                PatchDelete::Patch { id, diff } => PatchDelete::Patch {
                    id: *id,
                    diff: Cow::Borrowed(diff.as_ref()),
                },
                PatchDelete::Delete { id } => PatchDelete::Delete { id: *id },
            })
            .collect();
        let event = NotificationMacroEvent::status_updated(users, notification_updates);

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
