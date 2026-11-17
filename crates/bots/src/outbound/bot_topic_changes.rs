//! Every process's own read of the bot topic, for live bot updates.
//!
//! The consumer joins no consumer group: it assigns itself every partition
//! of the bot topic at its end, so each process sees every change published
//! after it starts, and it commits nothing.

use std::time::Duration;

use kafka_util::{InitialOffset, KafkaEventConsumer, Ungrouped};
use macro_event_broker::{
    EventBrokerError, KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection,
    MacroEventConsumerService,
};
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::{
    bot_updates::{BotChange, BotChangeSource},
    events::{BotMacroEvent, BotTopicEvent},
};

macro_event_broker::declare_topics!(DeclaredBotEvent: BotMacroEvent);

/// Longest wait for topic metadata while assigning partitions.
const TOPIC_METADATA_TIMEOUT: Duration = Duration::from_secs(10);
/// Name recorded on processing spans. There is no Kafka group behind it.
const CONSUMER_NAME: &str = "bot-updates";

type UngroupedBotConsumer = KafkaConsumerAdapter<Ungrouped, DeclaredBotEvent>;

/// Bot changes read off the bot topic by this process alone.
pub struct BotTopicChanges {
    consumer: MacroEventConsumerService<DeclaredBotEvent, UngroupedBotConsumer>,
}

impl BotTopicChanges {
    /// Assigns every current bot topic partition, starting at its end.
    /// Partitions added later need a new consumer.
    #[tracing::instrument(err)]
    pub fn from_env(brokers: &str) -> Result<Self, Report> {
        let consumer = KafkaEventConsumer::<Ungrouped>::from_env(brokers)
            .context("failed to create the bot update consumer")?;
        let consumer =
            UngroupedBotConsumer::new(consumer, InitialOffset::Latest, TOPIC_METADATA_TIMEOUT)
                .context("failed to assign bot topic partitions")?;
        tracing::info!(
            topics = ?DeclaredBotEvent::topics(),
            "bot update consumer listening"
        );
        Ok(Self {
            consumer: MacroEventConsumerService::new(consumer),
        })
    }
}

impl BotChangeSource for BotTopicChanges {
    async fn recv(&self) -> Result<BotChange, Report> {
        loop {
            let message = self
                .consumer
                .recv()
                .await
                .context("failed to receive a bot topic event")?;
            let kafka_message = message.inner();
            // Parented on the publisher's trace headers, so the delivery that
            // follows joins the trace of the write that changed the bot.
            let span = kafka_util::consumer_span(kafka_message, CONSUMER_NAME);
            let decoded = span.in_scope(|| message.decode_payload());
            let event = match decoded {
                Ok(DeclaredBotEvent::BotMacroEvent(event)) => event,
                Err(EventBrokerError::UnsupportedSchemaVersion {
                    topic,
                    expected,
                    actual,
                }) => {
                    span.in_scope(|| {
                        tracing::warn!(
                            topic,
                            expected,
                            actual,
                            "skipping a bot topic event with an unsupported schema version"
                        );
                    });
                    continue;
                }
                Err(error) => {
                    // Nothing is committed, so a bad record is skipped rather
                    // than retried.
                    kafka_util::record_span_error(&span, &error);
                    span.in_scope(|| {
                        tracing::warn!(error = ?error, "skipping an undecodable bot topic event");
                    });
                    continue;
                }
            };
            let topic_event = &event.event().event;
            let channel_id = match topic_event {
                BotTopicEvent::ChannelChanged(metadata) => Some(metadata.channel_id),
                BotTopicEvent::Created(_)
                | BotTopicEvent::Updated(_)
                | BotTopicEvent::Deleted(_) => None,
            };
            return Ok(BotChange {
                bot_id: topic_event.bot_id(),
                channel_id,
                span,
            });
        }
    }
}
