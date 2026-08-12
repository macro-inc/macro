//! Independent Kafka consumer for WebSocket notification delivery requests.
//!
//! Every process receives every message published after it starts because this adapter manually
//! assigns all `macro.notifications` partitions without joining a durable consumer group. It does
//! not commit offsets.

#[cfg(test)]
mod test;

use std::time::Duration;

use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    Event, EventBrokerError, KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService,
    MessageParts, Topic, TopicEvent,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};

use crate::domain::{
    models::websocket_notification_event::{
        JsonNotificationMacroEvent, NotificationTopicEvent, WebSocketNotificationMetadata,
    },
    ports::WebSocketNotificationConsumer,
};

/// Maximum time to wait for notification topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type NotificationEventConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: JsonNotificationMacroEvent);

#[derive(Deserialize, Serialize)]
struct SchemaVersionPayload {}

impl TopicEvent for SchemaVersionPayload {
    type Topic = <NotificationTopicEvent<serde_json::Value> as TopicEvent>::Topic;

    const SCHEMA_VERSION: u8 = NotificationTopicEvent::<serde_json::Value>::SCHEMA_VERSION;
}

fn validate_notification_schema(message: &impl MessageParts) -> Result<(), EventBrokerError> {
    let payload = message
        .payload()
        .ok_or(EventBrokerError::MissingMessagePayload)?;
    let actual = Event::<SchemaVersionPayload>::decode(payload)?.schema_version;
    let expected = NotificationTopicEvent::<serde_json::Value>::SCHEMA_VERSION;
    if actual != expected {
        return Err(EventBrokerError::UnsupportedSchemaVersion {
            topic: <<NotificationTopicEvent<serde_json::Value> as TopicEvent>::Topic as Topic>::TOPIC_STR,
            expected,
            actual,
        });
    }
    Ok(())
}

/// Independent consumer of WebSocket notification delivery requests.
///
/// This consumer starts at the end of every current `macro.notifications` partition, so it receives
/// only messages published after construction. It does not join a durable consumer group or persist
/// offsets. Partitions added after construction require a new consumer so they can be assigned.
pub struct NotificationTopicConsumer {
    consumer: NotificationEventConsumer,
}

impl NotificationTopicConsumer {
    /// Creates a consumer and assigns every current notification topic partition.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create independent WebSocket notification consumer")?;
        let consumer =
            IndependentKafkaConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign WebSocket notification topic partitions")?;

        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
            "independent WebSocket notification consumer listening"
        );

        Ok(Self {
            consumer: NotificationEventConsumer::new(consumer),
        })
    }

    /// Receives and decodes the next typed WebSocket notification event.
    ///
    /// This operation is cancel-safe. Unsupported schema versions are poison records and are
    /// skipped. Other missing or malformed payload data is returned as an error.
    pub async fn recv(&self) -> Result<WebSocketNotificationMetadata<serde_json::Value>, Report> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .context("failed to receive WebSocket notification event")?;
            let kafka_message = message.inner();
            match validate_notification_schema(kafka_message) {
                Ok(()) => {}
                Err(EventBrokerError::UnsupportedSchemaVersion {
                    topic,
                    expected,
                    actual,
                }) => {
                    tracing::warn!(
                        topic,
                        expected,
                        actual,
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping WebSocket notification event with unsupported schema version"
                    );
                    continue;
                }
                Err(error) => {
                    return Err(Report::new(error)
                        .context("failed to decode WebSocket notification event envelope")
                        .into_dynamic());
                }
            }

            let event = message
                .decode_payload()
                .context("failed to decode WebSocket notification event")?;
            return match event {
                DeclaredMacroEvent::JsonNotificationMacroEvent(event) => Ok(event.into_message()),
            };
        }
    }
}

impl WebSocketNotificationConsumer for NotificationTopicConsumer {
    #[tracing::instrument(err, skip(self))]
    async fn recv(&self) -> Result<WebSocketNotificationMetadata<serde_json::Value>, Report> {
        NotificationTopicConsumer::recv(self).await
    }
}
