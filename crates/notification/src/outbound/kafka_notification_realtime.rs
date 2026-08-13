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
/// Each call publishes one user-scoped status update event on the `macro.notifications` topic.
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

        if updates
            .iter()
            .any(|update| update.user.as_ref() != first.user.as_ref())
        {
            rootcause::bail!("notification realtime update batch contains multiple users");
        }

        let notification_updates = updates
            .iter()
            .flat_map(|update| &update.update.updates)
            .map(|update| match update {
                PatchDelete::Patch { id, diff } => PatchDelete::Patch {
                    id: *id,
                    diff: Cow::Owned(diff.as_ref().clone()),
                },
                PatchDelete::Delete { id } => PatchDelete::Delete { id: *id },
            })
            .collect();
        let event = NotificationMacroEvent::status_updated(
            first.user.clone().into_owned(),
            notification_updates,
        );

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
