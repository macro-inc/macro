//! Kafka adapter for asynchronous WebSocket notification delivery.

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
use crate::domain::ports::WebSocketSender;

/// Kafka-backed implementation of the WebSocket sender port.
///
/// Each call publishes one message containing the full recipient list and notification payload.
pub struct KafkaWebSocketSender<B> {
    broker: B,
}

impl<B> KafkaWebSocketSender<B> {
    /// Creates a WebSocket sender backed by `broker`.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> WebSocketSender for KafkaWebSocketSender<B> {
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
            .context("failed to serialize websocket notification for Kafka")?;
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
            .context("failed to dispatch websocket notification Kafka event")?;
        publish
            .await
            .context("websocket notification Kafka publish task failed")?
            .context("failed to publish websocket notification to Kafka")?;

        // Kafka acknowledges durable publication, not delivery to an active WebSocket connection.
        Ok(HashSet::new())
    }
}
