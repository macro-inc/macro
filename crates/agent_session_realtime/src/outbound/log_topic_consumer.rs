//! Independent Kafka consumer of appended agent session log frames.
//!
//! Every process receives every run published after it starts: the adapter
//! manually assigns all `macro.agent_session_log` partitions without joining
//! a durable consumer group, and commits no offsets. A viewer who missed a
//! run while this process was down refetches the durable log, which is what
//! the receiver closing tells them to do.

#[cfg(test)]
mod test;

use std::time::Duration;

use agent_session::domain::events::{
    AgentSessionLogMacroEvent, AgentSessionLogTopicEvent, LogAppendedMetadata,
};
use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    EventBrokerError, KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::ports::AgentSessionLogConsumer;

/// Maximum time to wait for topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type LogEventConsumer = MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: AgentSessionLogMacroEvent);

/// Independent consumer of appended agent session log frames.
///
/// Starts at the end of every current partition, so it receives only runs
/// published after construction. Partitions added later need a new consumer.
pub struct LogTopicConsumer {
    consumer: LogEventConsumer,
}

impl LogTopicConsumer {
    /// Creates a consumer and assigns every current partition of the topic.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create independent agent session log consumer")?;
        let consumer =
            IndependentKafkaConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign agent session log topic partitions")?;
        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
            "independent agent session log consumer listening"
        );
        Ok(Self {
            consumer: LogEventConsumer::new(consumer),
        })
    }

    /// Receives and decodes the next run.
    ///
    /// Cancel-safe. An unsupported schema version is a poison record and is
    /// skipped; other malformed payloads are returned as errors.
    pub async fn recv(&self) -> Result<LogAppendedMetadata, Report> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .context("failed to receive agent session log event")?;
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
                        "dropping agent session log event with unsupported schema version"
                    );
                    continue;
                }
                Err(error) => {
                    return Err(Report::new(error)
                        .context("failed to decode agent session log event")
                        .into_dynamic());
                }
            };

            return match event {
                DeclaredMacroEvent::AgentSessionLogMacroEvent(event) => {
                    let AgentSessionLogTopicEvent::Appended(appended) = event.into_payload();
                    Ok(appended)
                }
            };
        }
    }
}

impl AgentSessionLogConsumer for LogTopicConsumer {
    #[tracing::instrument(err, skip(self))]
    async fn recv(&self) -> Result<LogAppendedMetadata, Report> {
        LogTopicConsumer::recv(self).await
    }
}
