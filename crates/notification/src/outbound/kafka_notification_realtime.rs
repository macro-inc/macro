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
/// Each user-scoped update is published as a typed status update event on the
/// `macro.notifications` topic.
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
        let events = updates
            .iter()
            .map(|update| {
                let notification_updates = update
                    .update
                    .updates
                    .iter()
                    .map(|update| match update {
                        PatchDelete::Patch { id, diff } => PatchDelete::Patch {
                            id: *id,
                            diff: Cow::Owned(diff.as_ref().clone()),
                        },
                        PatchDelete::Delete { id } => PatchDelete::Delete { id: *id },
                    })
                    .collect();

                NotificationMacroEvent::status_updated(
                    update.user.clone().into_owned(),
                    notification_updates,
                )
            })
            .collect::<Vec<_>>();

        let mut publishes = Vec::with_capacity(events.len());
        for event in &events {
            publishes.push(
                self.broker
                    .send_event(event)
                    .context("failed to dispatch notification status update Kafka event")?,
            );
        }

        for result in futures::future::join_all(publishes).await {
            result
                .context("notification status update Kafka publish task failed")?
                .context("failed to publish notification status update to Kafka")?;
        }

        Ok(())
    }
}
