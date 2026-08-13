//! Kafka adapter for asynchronous realtime notification delivery.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;
use serde::Serialize;

use crate::domain::models::websocket_notification_event::NotificationMacroEvent;
use crate::domain::ports::RealtimeSender;

/// Kafka-backed implementation of the realtime sender port.
///
/// Each call publishes one message containing the full recipient list and notification payload.
pub struct KafkaRealtimeSender<B> {
    broker: B,
}

impl<B> KafkaRealtimeSender<B> {
    /// Creates a realtime sender backed by `broker`.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> RealtimeSender for KafkaRealtimeSender<B> {
    #[tracing::instrument(
        err,
        skip_all,
        fields(recipient_count = recipients.len(), topic = "macro.notifications")
    )]
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let notification = serde_json::to_value(notification)
            .context("failed to serialize realtime notification for Kafka")?;
        let event = NotificationMacroEvent::new(
            recipients
                .iter()
                .map(|recipient| recipient.clone().into_owned())
                .collect(),
            notification,
        );

        let publish = self
            .broker
            .send_event(&event)
            .context("failed to dispatch realtime notification Kafka event")?;
        publish
            .await
            .context("realtime notification Kafka publish task failed")?
            .context("failed to publish realtime notification to Kafka")?;

        // Kafka acknowledges durable publication, not delivery to an active WebSocket connection.
        Ok(HashSet::new())
    }
}
