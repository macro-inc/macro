//! Kafka consumer for broker events that update the search index.
//!
//! The poll loop hands decoded events to one bounded, sequential worker and
//! commits each offset immediately after that handoff. Malformed records are
//! committed without a handoff so they cannot wedge a partition. Processing is
//! retried in-process; exhausted events are logged and dropped because their
//! offsets are already committed.
//!
//! Per-entity event mapping and processing live in the [`call`], [`channel`],
//! [`chat`], [`document`], [`project`], and [`property`] submodules; this module
//! owns the poll loop, worker, retry policy, and commit semantics.

#![allow(clippy::enum_variant_names)]

mod call;
mod channel;
mod chat;
mod context;
mod document;
mod project;
mod property;
#[cfg(test)]
mod test;

use std::{future::Future, time::Duration};

use ::call::domain::events::CallMacroEvent;
use ::chat::domain::events::ChatMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService};
use projects::domain::events::ProjectMacroEvent;
use properties::domain::events::PropertyMacroEvent;
use rdkafka::{
    consumer::CommitMode,
    message::{BorrowedMessage, Message as _},
};
use rootcause::prelude::{Report, ResultExt as _};
use tokio::sync::mpsc;
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use self::{
    call::process_call_event, channel::process_channel_event, chat::process_chat_event,
    document::process_document_event, project::process_project_event,
    property::process_property_event,
};

pub(crate) use self::context::KafkaProcessingContext;

/// Consumer group used for live search-index event offsets.
pub(crate) struct SearchProcessingConsumerGroup;

impl GroupName for SearchProcessingConsumerGroup {
    const GROUP_NAME: &'static str = "search-processing-service";
}

type SearchProcessingKafkaAdapter =
    KafkaConsumerAdapter<SearchProcessingConsumerGroup, DeclaredMacroEvent>;
type SearchProcessingKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, SearchProcessingKafkaAdapter>;

macro_event_broker::declare_topics!(
    DeclaredMacroEvent:
        CallMacroEvent,
        ChannelMacroEvent,
        ChatMacroEvent,
        DocumentMacroEvent,
        ProjectMacroEvent,
        PropertyMacroEvent,
);

/// Maximum number of decoded events waiting for the sequential worker.
const CHANNEL_CAPACITY: usize = 128;
/// Delay before polling Kafka again after a receive error.
const RECEIVE_ERROR_RETRY_DELAY: Duration = Duration::from_secs(1);
/// Total processing attempts before an event is dropped.
const MAX_PROCESSING_ATTEMPTS: u32 = 5;
/// Delay before the first retry; each later delay doubles.
const PROCESSING_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

/// A decoded search-processing event and its Kafka coordinates.
struct ReceivedEvent {
    event: DeclaredMacroEvent,
    partition: i32,
    offset: i64,
}

/// Outcome after the worker handles one decoded broker event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventOutcome {
    /// The corresponding search-index operation succeeded.
    Indexed,
    /// The recognized event does not require a search-index operation.
    Ignored,
    /// Processing failed after all retries and the already-committed event was dropped.
    Dropped,
}

/// Result of decoding and attempting a channel handoff.
///
/// Both successful handoffs and malformed records are safe to commit. A closed
/// worker channel must leave the current record uncommitted so supervision can
/// restart the consumer and redeliver it.
#[derive(Debug)]
enum HandoffOutcome<E> {
    HandedOff,
    MalformedRecord(E),
    WorkerClosed,
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
        Err(error) => return HandoffOutcome::MalformedRecord(error),
    };

    match sender.send(event).await {
        Ok(()) => HandoffOutcome::HandedOff,
        Err(_) => HandoffOutcome::WorkerClosed,
    }
}

fn attach_event_coordinates<E>(
    decoded: Result<DeclaredMacroEvent, E>,
    partition: i32,
    offset: i64,
) -> Result<ReceivedEvent, E> {
    decoded.map(|event| ReceivedEvent {
        event,
        partition,
        offset,
    })
}

#[tracing::instrument(skip(context, event), fields(partition, offset))]
async fn process_event(
    context: &KafkaProcessingContext,
    event: &DeclaredMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let db = &context.db;
    let opensearch_client = context.opensearch_client.as_ref();

    match event {
        DeclaredMacroEvent::CallMacroEvent(event) => {
            process_call_event(db, opensearch_client, event, partition, offset).await
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            process_channel_event(db, opensearch_client, event, partition, offset).await
        }
        DeclaredMacroEvent::ChatMacroEvent(event) => {
            process_chat_event(db, opensearch_client, event, partition, offset).await
        }
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            process_document_event(context, event, partition, offset).await
        }
        DeclaredMacroEvent::ProjectMacroEvent(event) => {
            process_project_event(db, opensearch_client, event, partition, offset).await
        }
        DeclaredMacroEvent::PropertyMacroEvent(event) => {
            process_property_event(db, opensearch_client, event, partition, offset).await
        }
    }
}

async fn run_event_worker(
    context: KafkaProcessingContext,
    mut events: mpsc::Receiver<ReceivedEvent>,
) {
    while let Some(received) = events.recv().await {
        let _ = process_event(
            &context,
            &received.event,
            received.partition,
            received.offset,
        )
        .await;
    }
    tracing::trace!("search processing event worker drained");
}

fn commit_logged(consumer: &SearchProcessingKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.inner().commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            topic = rdkafka::Message::topic(message),
            partition = message.partition(),
            offset = message.offset(),
            "committed search processing event offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            topic = rdkafka::Message::topic(message),
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit search processing event offset"
        ),
    }
}

async fn poll_events(
    consumer: &SearchProcessingKafkaConsumer,
    events: mpsc::Sender<ReceivedEvent>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("search processing event consumer shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(_) => { // error is logged in tracing automatically
                        tokio::time::sleep(RECEIVE_ERROR_RETRY_DELAY).await;
                        continue;
                    }
                };
                let kafka_message = message.inner();
                let decoded = attach_event_coordinates(
                    message.decode_payload(),
                    kafka_message.partition(),
                    kafka_message.offset(),
                );

                match handoff_decoded(&events, decoded).await {
                    HandoffOutcome::HandedOff => {}
                    HandoffOutcome::MalformedRecord(error) => tracing::error!(
                        error = ?error,
                        topic = rdkafka::Message::topic(kafka_message),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping undecodable search processing event"
                    ),
                    HandoffOutcome::WorkerClosed => {
                        tracing::error!(
                            topic = rdkafka::Message::topic(kafka_message),
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "search processing event worker channel closed; leaving offset uncommitted"
                        );
                        return Err(rootcause::report!(
                            "search processing event worker channel closed for topic {} at partition {} offset {}",
                            rdkafka::Message::topic(kafka_message),
                            kafka_message.partition(),
                            kafka_message.offset(),
                        ));
                    }
                }

                // Deliberately commit immediately after a successful handoff. The worker
                // owns retries and drops exhausted events without requesting redelivery.
                commit_logged(consumer, kafka_message);
            }
        }
    }

    Ok(())
}

/// Runs the bounded broker event poll-loop/worker pair until `shutdown` resolves.
///
/// The caller is responsible for supervising this function. A closed worker
/// channel returns an error without committing the current Kafka message. On
/// normal shutdown the sender is dropped and all buffered events are processed
/// before this function returns.
#[tracing::instrument(skip(context, shutdown), fields(brokers), err)]
pub(crate) async fn run_event_consumer(
    brokers: &str,
    context: KafkaProcessingContext,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<SearchProcessingConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<SearchProcessingConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .context("failed to subscribe to search processing event topics")?;
    let consumer = SearchProcessingKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = SearchProcessingConsumerGroup::GROUP_NAME,
        "search processing event consumer listening"
    );

    let (events_tx, events_rx) = mpsc::channel(CHANNEL_CAPACITY);
    let worker = tokio::spawn(run_event_worker(context, events_rx));
    let poll_result = poll_events(&consumer, events_tx, shutdown).await;
    let worker_result = worker.await;

    poll_result?;
    worker_result.map_err(|error| rootcause::report!(error))?;
    Ok(())
}
