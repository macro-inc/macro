//! Kafka adapter for notification status update publication.

#[cfg(test)]
mod test;

use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike as _;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;

use crate::domain::models::UserNotificationStatusUpdate;
use crate::domain::models::websocket_notification_event::NotificationMacroEvent;
use crate::domain::ports::NotificationRealtimePublisher;

/// Kafka-backed notification realtime publisher.
///
/// Each user-scoped update is published as its own delivery request on the
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
                let notification = serde_json::to_value(&update.update)
                    .context("failed to serialize notification status update for Kafka")?;
                Ok(NotificationMacroEvent::new(
                    vec![update.user.clone().into_owned()],
                    notification,
                ))
            })
            .collect::<Result<Vec<_>, Report>>()?;

        let mut publishes = Vec::with_capacity(events.len());
        for event in &events {
            publishes.push(
                self.broker
                    .send_event(event)
                    .context("failed to dispatch notification status update Kafka event")?,
            );
        }

        let publish_results = futures::future::join_all(publishes).await;
        for result in publish_results {
            result
                .context("notification status update Kafka publish task failed")?
                .context("failed to publish notification status update to Kafka")?;
        }

        Ok(())
    }
}
