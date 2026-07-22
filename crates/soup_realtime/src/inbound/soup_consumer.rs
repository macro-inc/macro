//! Independent Kafka consumer for recipient-targeted Soup messages.
//!
//! Every process receives every message published after it starts because this
//! adapter manually assigns all `macro.soup` partitions without joining a
//! durable consumer group. It does not commit offsets.

#[cfg(test)]
mod test;

use std::time::Duration;

use kafka_consumer_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    EventConsumer, MacroEvent, MacroEventConsumerService, MessageParts, MessageWrapper, Topic,
};
use macro_event_topics::MacroSoupRealtimeTopic;
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::models::{SoupMacroEvent, SoupRealtimeMessage};

/// Maximum time to wait for Soup topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaEventConsumer<Ungrouped>;
type SoupEventConsumer = MacroEventConsumerService<DeclaredMacroEvent, SoupKafkaEventConsumer>;

macro_event_broker::declare_topics!(SoupMacroEvent);

fn assigned_topics() -> [&'static str; 1] {
    [MacroSoupRealtimeTopic.as_str()]
}

struct ValidatedKafkaMessage {
    topic: String,
    key: String,
    payload: Vec<u8>,
}

impl MessageParts for ValidatedKafkaMessage {
    fn key(&self) -> &str {
        &self.key
    }

    fn payload(&self) -> &[u8] {
        &self.payload
    }

    fn topic(&self) -> &str {
        &self.topic
    }
}

struct SoupKafkaEventConsumer {
    inner: IndependentKafkaConsumer,
}

impl EventConsumer<DeclaredMacroEvent> for SoupKafkaEventConsumer {
    type MessageType<'a> = ValidatedKafkaMessage;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, DeclaredMacroEvent>, rootcause::Report> {
        let message = self
            .inner
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

        let key = message.key().ok_or_else(|| {
            rootcause::report!(
                "realtime Soup event had no recipient key (partition {} offset {})",
                message.partition(),
                message.offset()
            )
        })?;
        let key = std::str::from_utf8(key)
            .context("realtime Soup event had a non-UTF-8 recipient key")?;
        let payload = message
            .payload()
            .filter(|payload| !payload.is_empty())
            .ok_or_else(|| {
                rootcause::report!(
                    "realtime Soup event had an empty payload (partition {} offset {})",
                    message.partition(),
                    message.offset()
                )
            })?;

        Ok(MessageWrapper::new(ValidatedKafkaMessage {
            topic: message.topic().to_owned(),
            key: key.to_owned(),
            payload: payload.to_vec(),
        }))
    }
}

fn into_message(event: DeclaredMacroEvent) -> Result<SoupRealtimeMessage, Report> {
    let DeclaredMacroEvent::SoupMacroEvent(event) = event;
    let event_key = event.key().to_string();
    let message = event.into_message();
    if event_key != message.user_id.as_ref() {
        rootcause::bail!(
            "realtime Soup event key {event_key} did not match payload recipient {}",
            message.user_id
        );
    }

    Ok(message)
}

#[cfg(test)]
fn decode_message(topic: &str, key: &str, payload: &[u8]) -> Result<SoupRealtimeMessage, Report> {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(ValidatedKafkaMessage {
        topic: topic.to_owned(),
        key: key.to_owned(),
        payload: payload.to_vec(),
    });
    let event = message
        .decode_payload()
        .context("failed to decode Soup event")?;
    into_message(event)
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

        Ok(Self {
            consumer: SoupEventConsumer::new(SoupKafkaEventConsumer { inner: consumer }),
        })
    }

    /// Receives and decodes the next typed realtime Soup event.
    ///
    /// This operation is cancel-safe. Missing keys and malformed or unsupported
    /// payloads are returned as errors; because the consumer is ungrouped, a
    /// subsequent call proceeds to the next locally assigned record.
    #[tracing::instrument(skip(self), err)]
    pub async fn recv(&self) -> Result<SoupRealtimeMessage, Report> {
        let event = self
            .consumer
            .recv()
            .await
            .context("failed to decode realtime Soup event")?;
        into_message(event)
    }
}
