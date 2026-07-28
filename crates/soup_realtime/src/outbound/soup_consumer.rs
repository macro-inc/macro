//! Independent Kafka consumer for recipient-targeted Soup messages.
//!
//! Every process receives every message published after it starts because this
//! adapter manually assigns all `macro.soup` partitions without joining a
//! durable consumer group. It does not commit offsets.

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
    models::{SoupMacroEvent, SoupRealtimeMessage, SoupTopicEvent},
    ports::SoupRealtimeConsumer,
};

/// Maximum time to wait for Soup topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type SoupEventConsumer = MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: SoupMacroEvent);

#[derive(Deserialize, Serialize)]
struct SchemaVersionPayload {}

impl TopicEvent for SchemaVersionPayload {
    type Topic = <SoupTopicEvent as TopicEvent>::Topic;

    const SCHEMA_VERSION: u8 = SoupTopicEvent::SCHEMA_VERSION;
}

fn validate_soup_schema(message: &impl MessageParts) -> Result<(), EventBrokerError> {
    let payload = message
        .payload()
        .ok_or(EventBrokerError::MissingMessagePayload)?;
    let actual = Event::<SchemaVersionPayload>::decode(payload)?.schema_version;
    let expected = SoupTopicEvent::SCHEMA_VERSION;
    if actual != expected {
        return Err(EventBrokerError::UnsupportedSchemaVersion {
            topic: <<SoupTopicEvent as TopicEvent>::Topic as Topic>::TOPIC_STR,
            expected,
            actual,
        });
    }
    Ok(())
}

/// Independent consumer of recipient-targeted Soup messages.
///
/// This consumer starts at the end of every current `macro.soup` partition, so
/// it receives only messages published after construction. It does not join a
/// durable consumer group or persist offsets. Partitions added after
/// construction require a new consumer so they can be assigned.
pub struct SoupTopicConsumer {
    consumer: SoupEventConsumer,
}

impl SoupTopicConsumer {
    /// Creates a consumer and assigns every current Soup topic partition.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create independent realtime Soup consumer")?;
        let consumer =
            IndependentKafkaConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign realtime Soup topic partitions")?;

        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
            "independent realtime Soup consumer listening"
        );

        Ok(Self {
            consumer: SoupEventConsumer::new(consumer),
        })
    }

    /// Receives and decodes the next typed realtime Soup event.
    ///
    /// This operation is cancel-safe. Unsupported schema versions are poison
    /// records and are skipped. Other missing or malformed payload data is
    /// returned as an error.
    pub async fn recv(&self) -> Result<SoupRealtimeMessage, Report> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .context("failed to receive realtime Soup event")?;
            let kafka_message = message.inner();
            match validate_soup_schema(kafka_message) {
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
                        "dropping realtime Soup event with unsupported schema version"
                    );
                    continue;
                }
                Err(error) => {
                    return Err(Report::new(error)
                        .context("failed to decode realtime Soup event envelope")
                        .into_dynamic());
                }
            }

            let event = message
                .decode_payload()
                .context("failed to decode realtime Soup event")?;
            return match event {
                DeclaredMacroEvent::SoupMacroEvent(event) => Ok(event.into_message()),
            };
        }
    }
}

impl SoupRealtimeConsumer for SoupTopicConsumer {
    #[tracing::instrument(err, skip(self))]
    async fn recv(&self) -> Result<SoupRealtimeMessage, Report> {
        SoupTopicConsumer::recv(self).await
    }
}
