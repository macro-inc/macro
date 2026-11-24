//! Independent Kafka consumer for live channel timeline updates.
//!
//! Every process receives every update published after it starts: this adapter
//! assigns all `macro.channel_timeline` partitions without joining a consumer
//! group and commits no offsets. A missed update is recovered by the client's
//! catch-up read, not by redelivery.

use std::{sync::Arc, time::Duration};

use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    EventBrokerError, KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};

use super::{ChannelTimelineMacroEvent, ChannelTimelineTopicEvent};
use crate::domain::timeline_updates::{
    AddressedChannelTimelineUpdate, ChannelTimelineUpdateSource, ChannelTimelineUpdates,
};

/// Maximum time to wait for topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);
/// Label for this process-local reader on its processing spans.
const CONSUMER_NAME: &str = "channel_timeline_fanout";

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type ChannelTimelineEventConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: ChannelTimelineMacroEvent);

/// The channel timeline topic, read from its end once it exists.
pub struct ChannelTimelineTopic {
    brokers: Arc<str>,
}

impl ChannelTimelineTopic {
    /// The topic on `brokers`. Connects to nothing until it is opened.
    pub fn new(brokers: &str) -> Self {
        Self {
            brokers: brokers.into(),
        }
    }
}

/// The topic cannot be read: it does not exist or its brokers do not answer.
#[derive(Debug, thiserror::Error)]
#[error("failed to open the channel timeline topic: {0:?}")]
pub struct ChannelTimelineOpenError(Report);

impl ChannelTimelineUpdates for ChannelTimelineTopic {
    type Source = ChannelTimelineTopicConsumer;
    type Err = ChannelTimelineOpenError;

    /// Assigns the topic's partitions on a blocking thread: reading their
    /// metadata waits for the brokers.
    async fn open(&self) -> Result<Self::Source, Self::Err> {
        let brokers = Arc::clone(&self.brokers);
        let span = tracing::Span::current();
        tokio::task::spawn_blocking(move || {
            span.in_scope(|| ChannelTimelineTopicConsumer::from_env(&brokers))
        })
        .await
        .map_err(|error| ChannelTimelineOpenError(Report::new(error).into_dynamic()))?
        .map_err(ChannelTimelineOpenError)
    }
}

/// Independent consumer of the channel timeline topic, starting at its end.
pub struct ChannelTimelineTopicConsumer {
    consumer: ChannelTimelineEventConsumer,
}

impl ChannelTimelineTopicConsumer {
    /// Create a consumer and assign every current topic partition.
    #[tracing::instrument(name = "channel_timeline.open_topic", err)]
    fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create independent channel timeline consumer")?;
        let consumer =
            IndependentKafkaConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign channel timeline topic partitions")?;

        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
            "independent channel timeline consumer listening"
        );

        Ok(Self {
            consumer: ChannelTimelineEventConsumer::new(consumer),
        })
    }
}

/// The topic could not be read.
#[derive(Debug, thiserror::Error)]
#[error("failed to receive channel timeline update: {0:?}")]
pub struct ChannelTimelineReceiveError(Report);

impl ChannelTimelineUpdateSource for ChannelTimelineTopicConsumer {
    type Err = ChannelTimelineReceiveError;

    /// Cancel-safe. A record that does not decode is logged and skipped, so
    /// one bad record never stops delivery of the rest.
    async fn recv(&self) -> Result<(AddressedChannelTimelineUpdate, tracing::Span), Self::Err> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .map_err(ChannelTimelineReceiveError)?;
            let kafka_message = message.inner();
            let span = kafka_util::consumer_span(kafka_message, CONSUMER_NAME);

            match message.decode_payload() {
                Ok(DeclaredMacroEvent::ChannelTimelineMacroEvent(event)) => {
                    let ChannelTimelineTopicEvent::Updated(update) = event.into_topic_event();
                    return Ok((update, span));
                }
                Err(error) => {
                    let error = undecodable(&error);
                    kafka_util::record_span_error(&span, &error);
                    span.in_scope(|| {
                        tracing::warn!(
                            error = %error,
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "skipping channel timeline record that does not decode"
                        );
                    });
                }
            }
        }
    }
}

/// Why a record did not decode, without its content: a JSON error quotes
/// the value it rejected, and a rejected recipient id is personal data.
fn undecodable(error: &EventBrokerError) -> String {
    match error {
        EventBrokerError::Serialization(json) => format!(
            "payload does not decode ({:?} error at line {}, column {})",
            json.classify(),
            json.line(),
            json.column()
        ),
        EventBrokerError::Internal(_) => "internal event broker error".to_owned(),
        other => other.to_string(),
    }
}
