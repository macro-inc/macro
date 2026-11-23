//! Independent Kafka consumer for live channel timeline updates.
//!
//! Every process receives every update published after it starts: this adapter
//! assigns all `macro.channel_timeline` partitions without joining a consumer
//! group and commits no offsets. A missed update is recovered by the client's
//! catch-up read, not by redelivery.

use std::time::Duration;

use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    EventBrokerError, KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::message::Message as _;
use rootcause::prelude::{Report, ResultExt as _};

use super::{ChannelTimelineMacroEvent, ChannelTimelineTopicEvent};
use crate::domain::timeline_updates::{
    AddressedChannelTimelineUpdate, ChannelTimelineUpdateSource,
};

/// Maximum time to wait for topic metadata during partition assignment.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);
/// Label for this process-local reader on its processing spans.
const CONSUMER_NAME: &str = "channel_timeline_fanout";

type IndependentKafkaConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredMacroEvent>;
type ChannelTimelineEventConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, IndependentKafkaConsumer>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: ChannelTimelineMacroEvent);

/// Independent consumer of the channel timeline topic, starting at its end.
pub struct ChannelTimelineTopicConsumer {
    consumer: ChannelTimelineEventConsumer,
}

impl ChannelTimelineTopicConsumer {
    /// Create a consumer and assign every current topic partition.
    #[tracing::instrument(fields(brokers), err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
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

impl ChannelTimelineUpdateSource for ChannelTimelineTopicConsumer {
    /// Cancel-safe. A record that does not decode is logged and skipped, so
    /// one bad record never stops delivery of the rest.
    async fn recv(&self) -> Result<(AddressedChannelTimelineUpdate, tracing::Span), Report> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .context("failed to receive channel timeline update")?;
            let kafka_message = message.inner();
            let span = kafka_util::consumer_span(kafka_message, CONSUMER_NAME);

            match message.decode_payload() {
                Ok(DeclaredMacroEvent::ChannelTimelineMacroEvent(event)) => {
                    let ChannelTimelineTopicEvent::Updated(update) = event.into_topic_event();
                    return Ok((update, span));
                }
                Err(error) => {
                    kafka_util::record_span_error(&span, &error);
                    let unsupported =
                        matches!(error, EventBrokerError::UnsupportedSchemaVersion { .. });
                    span.in_scope(|| {
                        tracing::warn!(
                            error = ?error,
                            unsupported,
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
