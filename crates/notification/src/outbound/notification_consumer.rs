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
    EventBrokerError, KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};
use serde::{Serialize, de::DeserializeOwned};

use crate::domain::{
    models::websocket_notification_event::{
        JsonNotificationMacroEvent, WebSocketNotificationMetadata,
    },
    ports::WebSocketNotificationConsumer,
};

/// Maximum time to wait for notification topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type NotificationEventConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: JsonNotificationMacroEvent);

/// Independent consumer of WebSocket notification delivery requests decoded as `T`.
///
/// This consumer starts at the end of every current `macro.notifications` partition, so it receives
/// only messages published after construction. It does not join a durable consumer group or persist
/// offsets. Partitions added after construction require a new consumer so they can be assigned.
pub struct NotificationTopicConsumer<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    consumer: NotificationEventConsumer,
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
        let consumer =
            IndependentKafkaConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign WebSocket notification topic partitions")?;

        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
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
            let event = match message.decode_payload() {
                Ok(event) => event,
                Err(EventBrokerError::UnsupportedSchemaVersion {
                    topic,
                    expected,
                    actual,
                }) => {
                    let kafka_message = message.inner();
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
                        .context("failed to decode WebSocket notification event")
                        .into_dynamic());
                }
            };

            return match event {
                DeclaredMacroEvent::JsonNotificationMacroEvent(event) => {
                    let WebSocketNotificationMetadata {
                        recipients,
                        notification,
                    } = event.into_message();
                    let notification = serde_json::from_value(notification)
                        .context("failed to decode WebSocket notification payload")?;
                    Ok(WebSocketNotificationMetadata {
                        recipients,
                        notification,
                    })
                }
            };
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
