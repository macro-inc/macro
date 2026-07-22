//! Kafka consumer example for the `macro.projects` topic.
//!
//! Connects with the same `KAFKA_BROKERS` env var and environment-driven
//! transport as [`macro_event_broker::KafkaEventPublisher`] (plaintext for
//! `ENVIRONMENT=local`, TLS + SASL/OAUTHBEARER with MSK IAM otherwise),
//! subscribes to the [`ProjectMacroEvent`] topic and prints every project
//! lifecycle event it receives.
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
//!     cargo run -p projects --example projects_consumer
//! ```
//! or against the dev MSK cluster (needs AWS credentials and network access):
//! ```sh
//! ENVIRONMENT=develop AWS_REGION=us-east-1 KAFKA_BROKERS=<bootstrapBrokersSaslIam> \
//!     cargo run -p projects --example projects_consumer
//! ```

use anyhow::Context as _;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use projects::domain::events::{ProjectMacroEvent, ProjectTopicEvent};
use rdkafka::consumer::CommitMode;
use rdkafka::message::Message;
use tokio::sync::mpsc;

macro_env_var::env_var! {
    struct ConsumerEnvVars {
        KafkaBrokers,
    }
}

/// Consumer group for this example. Offsets are committed under this group, so
/// re-runs resume where the previous run left off.
struct ProjectsConsumerGroup;

impl GroupName for ProjectsConsumerGroup {
    const GROUP_NAME: &'static str = "projects-consumer-example";
}

/// Bounded capacity of the channel between the poll loop and the processor.
const CHANNEL_CAPACITY: usize = 128;

macro_event_broker::declare_topics!(DeclaredMacroEvent: ProjectMacroEvent);

type ProjectsKafkaAdapter = KafkaConsumerAdapter<ProjectsConsumerGroup, DeclaredMacroEvent>;
type ProjectsConsumerService = MacroEventConsumerService<DeclaredMacroEvent, ProjectsKafkaAdapter>;

/// A decoded event plus the Kafka coordinates it came from, as handed from the
/// poll loop to the processor over the channel.
struct ReceivedEvent {
    partition: i32,
    offset: i64,
    event: ProjectMacroEvent,
}

fn event_type(event: &ProjectTopicEvent) -> &'static str {
    match event {
        ProjectTopicEvent::Created(_) => "project.created",
        ProjectTopicEvent::Updated(_) => "project.updated",
        ProjectTopicEvent::Deleted(_) => "project.deleted",
        ProjectTopicEvent::Restored(_) => "project.restored",
        ProjectTopicEvent::PermanentlyDeleted(_) => "project.permanently_deleted",
        ProjectTopicEvent::Uploaded(_) => "project.uploaded",
    }
}

/// Print each received event. This stands in for real event handling — swap
/// the body for indexing, notifications, etc.
async fn process_events(mut events: mpsc::Receiver<ReceivedEvent>) {
    while let Some(received) = events.recv().await {
        let event = received.event;
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

    let consumer =
        KafkaEventConsumer::<ProjectsConsumerGroup>::from_env(env.kafka_brokers.as_ref())?;
    let consumer = KafkaConsumerAdapter::<ProjectsConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| anyhow::anyhow!("failed to subscribe to projects topic: {error:?}"))?;
    let consumer = ProjectsConsumerService::new(consumer);
    println!(
        "listening on topic={} group={} brokers={} (ctrl-c to stop)",
        DeclaredMacroEvent::topics()[0],
        ProjectsConsumerGroup::GROUP_NAME,
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

                let kafka_message = message.inner();
                match message.decode_payload() {
                    Ok(DeclaredMacroEvent::ProjectMacroEvent(event)) => {
                        events_tx
                            .send(ReceivedEvent {
                                partition: kafka_message.partition(),
                                offset: kafka_message.offset(),
                                event,
                            })
                            .await
                            .context("processor task closed unexpectedly")?;
                    }
                    // Undecodable messages are logged and skipped rather than
                    // wedging the partition on a poison message.
                    Err(e) => eprintln!(
                        "failed to decode message at partition {} offset {}: {e}",
                        kafka_message.partition(),
                        kafka_message.offset(),
                    ),
                }

                // Commit only after the event was handed to the processor:
                // at-least-once delivery (up to the channel buffer on a crash).
                let _ = consumer
                    .inner()
                    .commit_message(kafka_message, CommitMode::Async)
                    .inspect_err(|e| {
                        eprintln!("failed to commit offset {}: {e:?}", kafka_message.offset());
                    });
            }
        }
    }

    // Close the channel and let the processor drain what it already received.
    drop(events_tx);
    processor.await.context("processor task panicked")?;

    Ok(())
}
