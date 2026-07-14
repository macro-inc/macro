//! Kafka consumer example for the `macro.channels` topic.
//!
//! Connects with the same `KAFKA_BROKERS` env var and environment-driven
//! transport as [`macro_event_broker::KafkaEventPublisher`] (plaintext for
//! `ENVIRONMENT=local`, TLS + SASL/OAUTHBEARER with MSK IAM otherwise),
//! subscribes to [`MacroChannelsTopic`], and prints every channel event it
//! receives.
//!
//! The consumer follows the standard poll-loop / worker split: a Kafka poll
//! loop decodes messages and hands them to a processing task over a bounded
//! tokio mpsc channel (backpressure applies when the processor falls behind),
//! offsets are committed only after a successful handoff (at-least-once), and
//! ctrl-c drains the channel before exiting.
//!
//! Run against the local docker broker:
//! ```sh
//! ENVIRONMENT=local KAFKA_BROKERS=localhost:9092 \
//!     cargo run -p channels --example channels_consumer
//! ```
//! or against the dev MSK cluster (needs AWS credentials and network access):
//! ```sh
//! ENVIRONMENT=develop AWS_REGION=us-east-1 KAFKA_BROKERS=<bootstrapBrokersSaslIam> \
//!     cargo run -p channels --example channels_consumer
//! ```

use anyhow::Context as _;
use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use macro_env::Environment;
use macro_event_broker::outbound::msk_iam::configure_sasl_iam;
use macro_event_broker::{EventBrokerError, MacroEvent, MskIamClientContext, Topic as _};
use macro_event_topics::MacroChannelsTopic;
use rdkafka::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::error::KafkaResult;
use rdkafka::message::{BorrowedMessage, Message};
use tokio::sync::mpsc;

macro_env_var::env_var! {
    struct ConsumerEnvVars {
        KafkaBrokers,
    }
}

/// Consumer group id for this example. Offsets are committed under this group,
/// so re-runs resume where the previous run left off.
const GROUP_ID: &str = "channels-consumer-example";

/// Bounded capacity of the channel between the poll loop and the processor.
const CHANNEL_CAPACITY: usize = 128;

/// Consumer-specific event enum for a consumer subscribed to `macro.channels`,
/// following the pattern in `macro_event_broker/examples/example_event.rs`.
enum ChannelsConsumerEvent {
    /// Event received on [`MacroChannelsTopic`].
    Channels(ChannelMacroEvent),
}

impl ChannelsConsumerEvent {
    /// Decode one Kafka message into this consumer's event enum.
    fn decode(topic: &str, key: &str, payload: &[u8]) -> Result<Self, EventBrokerError> {
        match topic {
            topic if topic == MacroChannelsTopic.as_str() => {
                Ok(Self::Channels(ChannelMacroEvent::decode(key, payload)?))
            }
            unknown => Err(EventBrokerError::UnknownTopic(unknown.to_string())),
        }
    }
}

/// A decoded event plus the Kafka coordinates it came from, as handed from the
/// poll loop to the processor over the channel.
struct ReceivedEvent {
    partition: i32,
    offset: i64,
    event: ChannelsConsumerEvent,
}

/// The underlying consumer, split by transport (mirrors `KafkaEventPublisher`).
enum ChannelsConsumer {
    /// Unauthenticated plaintext connection (local docker broker).
    Plaintext(StreamConsumer),
    /// TLS + SASL/OAUTHBEARER with AWS MSK IAM auth (deployed clusters).
    MskIam(StreamConsumer<MskIamClientContext>),
}

impl ChannelsConsumer {
    /// Build a consumer for the given brokers, choosing the transport from the
    /// `ENVIRONMENT` variable exactly like the publisher does.
    fn from_env(brokers: &str) -> anyhow::Result<Self> {
        let mut config = ClientConfig::new();
        config
            .set("bootstrap.servers", brokers)
            .set("group.id", GROUP_ID)
            // Offsets are committed manually after a successful handoff.
            .set("enable.auto.commit", "false")
            // Start from the beginning of the topic on the first ever run.
            .set("auto.offset.reset", "earliest");

        let consumer = match Environment::new_or_prod() {
            Environment::Local => Self::Plaintext(
                config
                    .create()
                    .context("failed to create plaintext kafka consumer")?,
            ),
            Environment::Develop | Environment::Production => {
                configure_sasl_iam(&mut config);
                Self::MskIam(
                    config
                        .create_with_context(MskIamClientContext::from_env())
                        .context("failed to create MSK IAM kafka consumer")?,
                )
            }
        };

        Ok(consumer)
    }

    fn subscribe(&self) -> KafkaResult<()> {
        let topics = [MacroChannelsTopic.as_str()];
        match self {
            Self::Plaintext(consumer) => consumer.subscribe(&topics),
            Self::MskIam(consumer) => consumer.subscribe(&topics),
        }
    }

    /// Receive the next message. `StreamConsumer::recv` is cancel-safe, so it
    /// can sit in a `select!` without losing messages.
    async fn recv(&self) -> KafkaResult<BorrowedMessage<'_>> {
        match self {
            Self::Plaintext(consumer) => consumer.recv().await,
            Self::MskIam(consumer) => consumer.recv().await,
        }
    }

    fn commit(&self, message: &BorrowedMessage<'_>) -> KafkaResult<()> {
        match self {
            Self::Plaintext(consumer) => consumer.commit_message(message, CommitMode::Async),
            Self::MskIam(consumer) => consumer.commit_message(message, CommitMode::Async),
        }
    }
}

fn event_type(event: &ChannelTopicEvent) -> &'static str {
    match event {
        ChannelTopicEvent::Created(_) => "channel.created",
        ChannelTopicEvent::Updated(_) => "channel.updated",
        ChannelTopicEvent::Deleted(_) => "channel.deleted",
        ChannelTopicEvent::MessagePosted(_) => "channel.message_posted",
        ChannelTopicEvent::MessagePatched(_) => "channel.message_patched",
        ChannelTopicEvent::MessageDeleted(_) => "channel.message_deleted",
        ChannelTopicEvent::MessageAttachmentCreated(_) => "channel.message_attachment_created",
        ChannelTopicEvent::MessageAttachmentRemoved(_) => "channel.message_attachment_removed",
        ChannelTopicEvent::ParticipantAdded(_) => "channel.participant_added",
        ChannelTopicEvent::ParticipantRemoved(_) => "channel.participant_removed",
    }
}

/// Print each received event. This stands in for real event handling — swap
/// the body for indexing, notifications, etc.
async fn process_events(mut events: mpsc::Receiver<ReceivedEvent>) {
    while let Some(received) = events.recv().await {
        let ChannelsConsumerEvent::Channels(event) = received.event;
        let envelope = event.event();

        println!(
            "[partition {} offset {}] {} key={} event_id={} schema_version={}",
            received.partition,
            received.offset,
            event_type(&envelope.event),
            event.key(),
            envelope.event_id,
            envelope.schema_version,
        );
        match serde_json::to_string_pretty(envelope) {
            Ok(json) => println!("{json}"),
            Err(e) => eprintln!("failed to re-serialize event: {e}"),
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Surface tracing from macro_event_broker (e.g. MSK IAM token refreshes)
    // and librdkafka's internal connection/auth logs (bridged from the `log`
    // crate). Tune with RUST_LOG, e.g. RUST_LOG=debug for librdkafka detail.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let env = ConsumerEnvVars::new().context("KAFKA_BROKERS must be set")?;

    let consumer = ChannelsConsumer::from_env(env.kafka_brokers.as_ref())?;
    consumer
        .subscribe()
        .context("failed to subscribe to channels topic")?;
    println!(
        "listening on topic={} group={} brokers={} (ctrl-c to stop)",
        MacroChannelsTopic.as_str(),
        GROUP_ID,
        env.kafka_brokers.as_ref(),
    );

    let (events_tx, events_rx) = mpsc::channel::<ReceivedEvent>(CHANNEL_CAPACITY);
    let processor = tokio::spawn(process_events(events_rx));

    let mut shutdown = std::pin::pin!(tokio::signal::ctrl_c());
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                println!("received ctrl-c, shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(e) => {
                        eprintln!("kafka receive error: {e}");
                        continue;
                    }
                };

                let Some(payload) = message.payload() else {
                    eprintln!(
                        "skipping message with empty payload at partition {} offset {}",
                        message.partition(),
                        message.offset(),
                    );
                    let _ = consumer.commit(&message).inspect_err(|e| {
                        eprintln!("failed to commit offset {}: {e}", message.offset());
                    });
                    continue;
                };
                let key = String::from_utf8_lossy(message.key().unwrap_or_default());

                match ChannelsConsumerEvent::decode(message.topic(), key.as_ref(), payload) {
                    Ok(event) => {
                        events_tx
                            .send(ReceivedEvent {
                                partition: message.partition(),
                                offset: message.offset(),
                                event,
                            })
                            .await
                            .context("processor task closed unexpectedly")?;
                    }
                    // Undecodable messages are logged and skipped rather than
                    // wedging the partition on a poison message.
                    Err(e) => eprintln!(
                        "failed to decode message at partition {} offset {}: {e}",
                        message.partition(),
                        message.offset(),
                    ),
                }

                // Commit only after the event was handed to the processor:
                // at-least-once delivery (up to the channel buffer on a crash).
                let _ = consumer.commit(&message).inspect_err(|e| {
                    eprintln!("failed to commit offset {}: {e}", message.offset());
                });
            }
        }
    }

    // Close the channel and let the processor drain what it already received.
    drop(events_tx);
    processor.await.context("processor task panicked")?;

    Ok(())
}
