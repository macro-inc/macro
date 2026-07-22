//! Independent Kafka consumer for recipient-targeted Soup messages.
//!
//! Every process receives every message published after it starts because this
//! adapter manually assigns all `macro.soup` partitions without joining a
//! durable consumer group. It does not commit offsets.

#[cfg(test)]
mod test;

use std::time::Duration;

use kafka_consumer_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{EventBrokerError, Topic as _, TopicMessage};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::models::SoupRealtimeMessage;

/// Maximum time to wait for Soup topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaEventConsumer<Ungrouped>;

fn assigned_topics() -> [&'static str; 1] {
    [<SoupRealtimeMessage as TopicMessage>::Topic::default().as_str()]
}

fn decode_message(topic: &str, payload: &[u8]) -> Result<SoupRealtimeMessage, EventBrokerError> {
    <SoupRealtimeMessage as TopicMessage>::decode(topic, payload)
}

/// Independent consumer of recipient-targeted realtime Soup messages.
///
/// This consumer starts at the end of every current `macro.soup` partition, so
/// it receives only messages published after construction. It does not join a
/// durable consumer group or persist offsets. Partitions added after
/// construction require a new consumer so they can be assigned.
pub struct SoupTopicConsumer {
    consumer: IndependentKafkaConsumer,
}

impl SoupTopicConsumer {
    /// Creates a consumer and assigns every current Soup topic partition.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = IndependentKafkaConsumer::from_env(brokers)
            .context("failed to create independent realtime Soup consumer")?;
        consumer
            .assign_topics(
                &assigned_topics(),
                InitialOffset::Latest,
                TOPIC_METADATA_TIMEOUT,
            )
            .context("failed to assign realtime Soup topic partitions")?;

        tracing::info!(
            topics = ?assigned_topics(),
            "independent realtime Soup consumer listening"
        );

        Ok(Self { consumer })
    }

    /// Receives and decodes the next realtime Soup message.
    ///
    /// This operation is cancel-safe. Empty, malformed, and unsupported-version
    /// payloads are returned as errors; because the consumer is ungrouped, a
    /// subsequent call proceeds to the next locally assigned record.
    #[tracing::instrument(skip(self), err)]
    pub async fn recv(&self) -> Result<SoupRealtimeMessage, Report> {
        let message = self
            .consumer
            .recv()
            .await
            .context("failed to receive realtime Soup message")?;

        tracing::trace!(
            topic = message.topic(),
            partition = message.partition(),
            offset = message.offset(),
            payload_len = message.payload().map_or(0, <[u8]>::len),
            "received realtime Soup message"
        );

        let payload = message
            .payload()
            .filter(|payload| !payload.is_empty())
            .ok_or_else(|| {
                rootcause::report!(
                    "realtime Soup message had an empty payload (partition {} offset {})",
                    message.partition(),
                    message.offset()
                )
            })?;

        let decoded = decode_message(message.topic(), payload).context_with(|| {
            format!(
                "failed to decode realtime Soup message from partition {} offset {}",
                message.partition(),
                message.offset()
            )
        })?;

        let key = message.key().ok_or_else(|| {
            rootcause::report!(
                "realtime Soup message had no recipient key (partition {} offset {})",
                message.partition(),
                message.offset()
            )
        })?;
        let key = std::str::from_utf8(key)
            .context("realtime Soup message had a non-UTF-8 recipient key")?;

        if key != decoded.key() {
            rootcause::bail!(
                "realtime Soup message key {key} did not match payload recipient {}",
                decoded.key()
            );
        }

        Ok(decoded)
    }
}
