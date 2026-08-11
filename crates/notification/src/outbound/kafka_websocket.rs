//! Kafka adapter for asynchronous WebSocket notification delivery.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_event_broker::EventPublisher;
use macro_event_topics::{MacroNotificationsTopic, Topic as _};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;
use serde::Serialize;
use sha2::{Digest as _, Sha256};

use crate::domain::ports::WebSocketSender;

#[derive(Serialize)]
struct KafkaNotificationMessage<'a, 'recipient, T> {
    recipients: &'a [MacroUserIdStr<'recipient>],
    notification: &'a T,
}

/// Kafka-backed implementation of the WebSocket sender port.
///
/// Each call publishes one message containing the full recipient list and notification payload.
pub struct KafkaWebSocketSender<P> {
    publisher: P,
}

impl<P> KafkaWebSocketSender<P> {
    /// Creates a WebSocket sender backed by `publisher`.
    pub fn new(publisher: P) -> Self {
        Self { publisher }
    }
}

impl<P: EventPublisher> WebSocketSender for KafkaWebSocketSender<P> {
    #[tracing::instrument(
        err,
        skip_all,
        fields(
            recipient_count = recipients.len(),
            topic = MacroNotificationsTopic::TOPIC_STR,
        )
    )]
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let payload = serde_json::to_vec(&KafkaNotificationMessage {
            recipients,
            notification,
        })
        .context("failed to serialize websocket notification for Kafka")?;
        let key = hex::encode(Sha256::digest(&payload));

        self.publisher
            .publish::<MacroNotificationsTopic>(&key, &payload)
            .await
            .context("failed to publish websocket notification to Kafka")?;

        // Kafka acknowledges durable publication, not delivery to an active WebSocket connection.
        Ok(HashSet::new())
    }
}
