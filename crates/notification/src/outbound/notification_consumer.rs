//! Independent Kafka consumer for WebSocket notification delivery requests.
//!
//! Every process receives every message published after it starts because this adapter manually
//! assigns all `macro.notifications` partitions without joining a durable consumer group. It does
//! not commit offsets.

#[cfg(test)]
mod test;

use std::{marker::PhantomData, time::Duration};

use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    Event, EventBrokerError, KafkaConsumerAdapter, MacroEvent, MacroEventCollection,
    MacroEventConsumerService, MessageParts, Topic, TopicEvent,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::{
    models::websocket_notification_event::{
        NotificationMacroEvent, NotificationTopicEvent, WebSocketNotificationMetadata,
    },
    ports::WebSocketNotificationConsumer,
};

/// Maximum time to wait for notification topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

/// Typed event collection for a notification payload decoded as `T`.
struct DeclaredMacroEvent<T>(NotificationMacroEvent<T>);

impl<T> MacroEventCollection for DeclaredMacroEvent<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    fn decode<M: MessageParts>(message: &M) -> Result<Self, EventBrokerError> {
        let expected_topic = <<NotificationTopicEvent<T> as TopicEvent>::Topic as Topic>::TOPIC_STR;
        if message.topic() != expected_topic {
            return Err(EventBrokerError::UnknownTopic(message.topic().to_owned()));
        }

        let key = message.key().ok_or(EventBrokerError::MissingMessageKey)?;
        let payload = message
            .payload()
            .ok_or(EventBrokerError::MissingMessagePayload)?;
        let event = NotificationMacroEvent::<T>::decode(key, payload)?;
        let expected = NotificationTopicEvent::<T>::SCHEMA_VERSION;
        let actual = event.event().schema_version;
        if actual != expected {
            return Err(EventBrokerError::UnsupportedSchemaVersion {
                topic: expected_topic,
                expected,
                actual,
            });
        }

        Ok(Self(event))
    }

    fn topics() -> &'static [&'static str] {
        &[<<NotificationTopicEvent<T> as TopicEvent>::Topic as Topic>::TOPIC_STR]
    }
}

type IndependentKafkaConsumer<T> = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent<T>>;
type NotificationEventConsumer<T> =
    MacroEventConsumerService<DeclaredMacroEvent<T>, IndependentKafkaConsumer<T>>;

#[derive(Deserialize, Serialize)]
struct SchemaVersionPayload {}

impl TopicEvent for SchemaVersionPayload {
    type Topic = <NotificationTopicEvent<()> as TopicEvent>::Topic;

    const SCHEMA_VERSION: u8 = NotificationTopicEvent::<()>::SCHEMA_VERSION;
}

fn validate_notification_schema(message: &impl MessageParts) -> Result<(), EventBrokerError> {
    let payload = message
        .payload()
        .ok_or(EventBrokerError::MissingMessagePayload)?;
    let actual = Event::<SchemaVersionPayload>::decode(payload)?.schema_version;
    let expected = SchemaVersionPayload::SCHEMA_VERSION;
    if actual != expected {
        return Err(EventBrokerError::UnsupportedSchemaVersion {
            topic: <<SchemaVersionPayload as TopicEvent>::Topic as Topic>::TOPIC_STR,
            expected,
            actual,
        });
    }
    Ok(())
}

/// Independent consumer of WebSocket notification delivery requests decoded as `T`.
///
/// This consumer starts at the end of every current `macro.notifications` partition, so it receives
/// only messages published after construction. It does not join a durable consumer group or persist
/// offsets. Partitions added after construction require a new consumer so they can be assigned.
pub struct NotificationTopicConsumer<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    consumer: NotificationEventConsumer<T>,
    payload: PhantomData<fn() -> T>,
}

impl<T> NotificationTopicConsumer<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    /// Creates a consumer and assigns every current notification topic partition.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create independent WebSocket notification consumer")?;
        let consumer = IndependentKafkaConsumer::<T>::new(
            consumer,
            InitialOffset::Latest,
            TOPIC_METADATA_TIMEOUT,
        )
        .context("failed to assign WebSocket notification topic partitions")?;

        tracing::info!(
            topics = ?DeclaredMacroEvent::<T>::topics(),
            "independent WebSocket notification consumer listening"
        );

        Ok(Self {
            consumer: NotificationEventConsumer::new(consumer),
            payload: PhantomData,
        })
    }

    /// Receives and decodes the next typed WebSocket notification event.
    ///
    /// This operation is cancel-safe. Unsupported schema versions are poison records and are
    /// skipped. Other missing or malformed payload data is returned as an error.
    pub async fn recv(&self) -> Result<WebSocketNotificationMetadata<T>, Report> {
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
            return Ok(event.0.into_message());
        }
    }
}

impl<T> WebSocketNotificationConsumer<T> for NotificationTopicConsumer<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    #[tracing::instrument(err, skip(self))]
    async fn recv(&self) -> Result<WebSocketNotificationMetadata<T>, Report> {
        NotificationTopicConsumer::recv(self).await
    }
}
