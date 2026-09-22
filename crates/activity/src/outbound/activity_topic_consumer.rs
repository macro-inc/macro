//! Independent Kafka consumer for activity topic events.
//!
//! Every process receives every message published after it starts because
//! this adapter manually assigns all `macro.activity` partitions without
//! joining a durable consumer group. It does not commit offsets.

use std::time::Duration;

use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    EventBrokerError, KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::events::{ActivityMacroEvent, ActivityTopicEvent};
use crate::domain::realtime::ActivityTopicEventConsumer;

/// Maximum time to wait for topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type ActivityEventConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: ActivityMacroEvent);

/// Independent consumer of activity topic events.
///
/// Starts at the end of every current `macro.activity` partition, so it
/// receives only messages published after construction. Partitions added
/// after construction require a new consumer so they can be assigned.
pub struct ActivityTopicConsumer {
    consumer: ActivityEventConsumer,
}

impl ActivityTopicConsumer {
    /// Creates a consumer and assigns every current activity topic partition.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create independent activity topic consumer")?;
        let consumer =
            IndependentKafkaConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign activity topic partitions")?;

        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
            "independent activity topic consumer listening"
        );

        Ok(Self {
            consumer: ActivityEventConsumer::new(consumer),
        })
    }

    /// Receives and decodes the next activity topic event.
    ///
    /// Cancel-safe. Unsupported schema versions are poison records and are
    /// skipped; other malformed payloads are returned as errors.
    pub async fn recv(&self) -> Result<ActivityTopicEvent, Report> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .context("failed to receive activity topic event")?;
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
                        "dropping activity topic event with unsupported schema version"
                    );
                    continue;
                }
                Err(error) => {
                    return Err(Report::new(error)
                        .context("failed to decode activity topic event")
                        .into_dynamic());
                }
            };

            return match event {
                DeclaredMacroEvent::ActivityMacroEvent(event) => Ok(event.into_topic_event()),
            };
        }
    }
}

impl ActivityTopicEventConsumer for ActivityTopicConsumer {
    #[tracing::instrument(err, skip(self))]
    async fn recv(&self) -> Result<ActivityTopicEvent, Report> {
        ActivityTopicConsumer::recv(self).await
    }
}
