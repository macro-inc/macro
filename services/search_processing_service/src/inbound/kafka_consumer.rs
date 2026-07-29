//! Kafka consumer for call lifecycle events that update the search index.
//!
//! The poll loop hands decoded events to one bounded, sequential worker and
//! commits each offset after that handoff. Poison records are committed without
//! a handoff so they cannot wedge a partition. Processing is retried in-process;
//! exhausted events are logged and dropped because their offsets are already
//! committed.

#[cfg(test)]
mod test;

use std::{future::Future, time::Duration};

use call::domain::events::{CallMacroEvent, CallTopicEvent};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    EventBrokerError, KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _,
    MacroEventConsumerService, MessageParts,
};
use macro_event_topics::{MacroCallsTopic, Topic as _};
use opensearch_client::OpensearchClient;
use rdkafka::{
    consumer::CommitMode,
    message::{BorrowedMessage, Message as _},
};
use rootcause::prelude::{Report, ResultExt as _};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_retry::{Retry, strategy::ExponentialBackoff};
use uuid::Uuid;

use crate::process::call::{process_call_record, process_remove_call_record};

/// Durable group used for live call search-index updates.
pub(crate) struct SearchProcessingConsumerGroup;

impl GroupName for SearchProcessingConsumerGroup {
    const GROUP_NAME: &'static str = "search-processing-service";
}

macro_event_broker::declare_topics!(DeclaredMacroEvent: CallMacroEvent);

type SearchProcessingKafkaAdapter =
    KafkaConsumerAdapter<SearchProcessingConsumerGroup, DeclaredMacroEvent>;
type SearchProcessingKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, SearchProcessingKafkaAdapter>;

/// Maximum number of decoded events waiting for the sequential worker.
const CHANNEL_CAPACITY: usize = 128;
/// Total processing attempts before an event is dropped.
const MAX_PROCESSING_ATTEMPTS: u32 = 5;
/// Delay before the first retry; each later delay doubles.
const PROCESSING_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

/// A decoded call event and its Kafka coordinates.
struct ReceivedCallEvent {
    event: CallMacroEvent,
    partition: i32,
    offset: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallIndexAction {
    Upsert { call_id: Uuid },
    Remove { call_id: Uuid, channel_id: Uuid },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CallEventDescription {
    action: CallIndexAction,
    call_id: Uuid,
    event_type: &'static str,
}

/// Result of decoding and attempting a channel handoff.
///
/// Both successful handoffs and poison messages are safe to commit. A closed
/// worker channel must leave the current record uncommitted so supervision can
/// restart the consumer and redeliver it.
#[derive(Debug)]
enum HandoffOutcome<E> {
    HandedOff,
    Poison(E),
    WorkerClosed,
}

fn describe_call_event(event: &CallTopicEvent) -> CallEventDescription {
    match event {
        CallTopicEvent::Started(metadata) => CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: metadata.call_id,
            event_type: "call.started",
        },
        CallTopicEvent::RecordArchived(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_archived",
        },
        CallTopicEvent::RecordUpdated(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_updated",
        },
        CallTopicEvent::RecordDeleted(metadata) => CallEventDescription {
            action: CallIndexAction::Remove {
                call_id: metadata.call_id,
                channel_id: metadata.channel_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_deleted",
        },
        CallTopicEvent::RecordSummarized(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_summarized",
        },
        CallTopicEvent::RecordingReady(metadata) => CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: metadata.call_id,
            event_type: "call.recording_ready",
        },
    }
}

fn processing_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take((MAX_PROCESSING_ATTEMPTS - 1) as usize)
}

async fn retry_processing_with_strategy<I, F, Fut, E>(
    strategy: I,
    mut operation: F,
) -> Result<(), E>
where
    I: Iterator<Item = Duration>,
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<(), E>>,
{
    let mut attempt = 0;
    Retry::start(strategy, || {
        attempt += 1;
        operation(attempt)
    })
    .await
}

async fn retry_processing<F, Fut, E>(operation: F) -> Result<(), E>
where
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<(), E>>,
{
    retry_processing_with_strategy(processing_retry_strategy(), operation).await
}

async fn handoff_decoded<T, E>(
    sender: &mpsc::Sender<T>,
    decoded: Result<T, E>,
) -> HandoffOutcome<E> {
    let event = match decoded {
        Ok(event) => event,
        Err(error) => return HandoffOutcome::Poison(error),
    };

    match sender.send(event).await {
        Ok(()) => HandoffOutcome::HandedOff,
        Err(_) => HandoffOutcome::WorkerClosed,
    }
}

fn decode_received_call_event<M: MessageParts>(
    message: &M,
    partition: i32,
    offset: i64,
) -> Result<ReceivedCallEvent, EventBrokerError> {
    let DeclaredMacroEvent::CallMacroEvent(event) = DeclaredMacroEvent::decode(message)?;
    Ok(ReceivedCallEvent {
        event,
        partition,
        offset,
    })
}

async fn process_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: CallIndexAction,
) -> anyhow::Result<()> {
    match action {
        CallIndexAction::Upsert { call_id } => {
            process_call_record(opensearch_client, db, call_id, None).await
        }
        CallIndexAction::Remove {
            call_id,
            channel_id,
        } => process_remove_call_record(opensearch_client, channel_id, Some(call_id), None).await,
        CallIndexAction::Ignore => Ok(()),
    }
}

async fn process_received_call_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    received: ReceivedCallEvent,
) {
    let description = describe_call_event(&received.event.event().event);
    if description.action == CallIndexAction::Ignore {
        tracing::trace!(
            call_id = %description.call_id,
            event_type = description.event_type,
            partition = received.partition,
            offset = received.offset,
            "ignoring call event without a search-index action"
        );
        return;
    }

    let result = retry_processing(|attempt| async move {
        tracing::trace!(
            call_id = %description.call_id,
            event_type = description.event_type,
            partition = received.partition,
            offset = received.offset,
            attempt,
            "processing call search-index event"
        );
        process_index_action(db, opensearch_client, description.action)
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        call_id = %description.call_id,
                        event_type = description.event_type,
                        partition = received.partition,
                        offset = received.offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "call search-index processing failed, retrying"
                    );
                }
            })
    })
    .await;

    let _ = result.inspect_err(|error| {
        tracing::error!(
            error = ?error,
            call_id = %description.call_id,
            event_type = description.event_type,
            partition = received.partition,
            offset = received.offset,
            attempts = MAX_PROCESSING_ATTEMPTS,
            "dropping call event after processing retries were exhausted"
        );
    });
}

async fn run_call_event_worker(
    db: PgPool,
    opensearch_client: OpensearchClient,
    mut events: mpsc::Receiver<ReceivedCallEvent>,
) {
    while let Some(received) = events.recv().await {
        process_received_call_event(&db, &opensearch_client, received).await;
    }
    tracing::trace!("call search-index worker drained");
}

fn commit_logged(consumer: &SearchProcessingKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.inner().commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            partition = message.partition(),
            offset = message.offset(),
            "committed call event offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit call event offset"
        ),
    }
}

async fn poll_call_events(
    consumer: &SearchProcessingKafkaConsumer,
    events: mpsc::Sender<ReceivedCallEvent>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("call event consumer shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "Kafka receive error for call events");
                        continue;
                    }
                };
                let kafka_message = message.inner();
                let decoded = decode_received_call_event(
                    kafka_message,
                    kafka_message.partition(),
                    kafka_message.offset(),
                );

                match handoff_decoded(&events, decoded).await {
                    HandoffOutcome::HandedOff => {}
                    HandoffOutcome::Poison(error) => tracing::error!(
                        error = ?error,
                        topic = rdkafka::Message::topic(kafka_message),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping undecodable call event"
                    ),
                    HandoffOutcome::WorkerClosed => {
                        tracing::error!(
                            topic = rdkafka::Message::topic(kafka_message),
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "call event worker channel closed; leaving offset uncommitted"
                        );
                        return Err(rootcause::report!(
                            "call event worker channel closed at partition {} offset {}",
                            kafka_message.partition(),
                            kafka_message.offset(),
                        ));
                    }
                }

                commit_logged(consumer, kafka_message);
            }
        }
    }

    Ok(())
}

/// Runs the bounded call event poll-loop/worker pair until `shutdown` resolves.
///
/// The caller is responsible for supervising this function. A closed worker
/// channel returns an error without committing the current Kafka message. On
/// normal shutdown the sender is dropped and all buffered events are processed
/// before this function returns.
#[tracing::instrument(skip(db, opensearch_client, shutdown), fields(brokers), err)]
pub(crate) async fn run_event_consumer(
    brokers: &str,
    db: PgPool,
    opensearch_client: OpensearchClient,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<SearchProcessingConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<SearchProcessingConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .context("failed to subscribe to the calls topic")?;
    let consumer = SearchProcessingKafkaConsumer::new(consumer);
    tracing::info!(
        topic = MacroCallsTopic::TOPIC_STR,
        group = SearchProcessingConsumerGroup::GROUP_NAME,
        "call event consumer listening"
    );

    let (events_tx, events_rx) = mpsc::channel(CHANNEL_CAPACITY);
    let worker = tokio::spawn(run_call_event_worker(db, opensearch_client, events_rx));
    let poll_result = poll_call_events(&consumer, events_tx, shutdown).await;
    let worker_result = worker.await;

    poll_result?;
    worker_result.map_err(|error| rootcause::report!(error))?;
    Ok(())
}
