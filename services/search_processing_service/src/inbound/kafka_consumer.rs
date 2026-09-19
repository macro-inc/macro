//! Kafka consumer for broker events that update the search index.
//!
//! The poll loop shards each decoded event by its ordering key onto one of a
//! fixed pool of bounded, sequential workers and commits the offset
//! immediately after that handoff. Events sharing an ordering key — the
//! entity whose search documents they mutate — stay on one worker in
//! partition order; unrelated events process in parallel. Malformed records
//! are committed without a handoff so they cannot wedge a partition.
//! Processing is retried in-process; exhausted events are logged and dropped
//! because their offsets are already committed.
//!
//! Per-entity event mapping and processing live in the [`calendar_event`],
//! [`call`], [`channel`], [`chat`], [`document`], [`email`], [`project`], and
//! [`property`] submodules; this module owns the poll loop, worker, retry
//! policy, and commit semantics.

#![allow(clippy::enum_variant_names)]

mod calendar_event;
mod call;
mod channel;
mod chat;
mod context;
mod document;
mod email;
mod project;
mod property;
#[cfg(test)]
mod test;

use std::{
    borrow::Cow,
    collections::hash_map::DefaultHasher,
    future::Future,
    hash::{Hash as _, Hasher as _},
    time::Duration,
};

use ::call::domain::events::CallMacroEvent;
use ::chat::domain::events::ChatMacroEvent;
use ::email::domain::events::EmailMacroEvent;
use calendar_events::domain::events::CalendarMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection, MacroEventConsumerService,
};
use projects::domain::events::ProjectMacroEvent;
use properties::domain::events::PropertyMacroEvent;
use rdkafka::{
    consumer::CommitMode,
    message::{BorrowedMessage, Message as _},
};
use rootcause::prelude::{Report, ResultExt as _};
use tokio::{sync::mpsc, task::JoinHandle};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use self::{
    calendar_event::process_calendar_event,
    call::process_call_event,
    channel::process_channel_event,
    chat::process_chat_event,
    document::process_document_event,
    email::{email_ordering_key, process_email_event},
    project::process_project_event,
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
        CalendarMacroEvent,
        CallMacroEvent,
        ChannelMacroEvent,
        ChatMacroEvent,
        DocumentMacroEvent,
        EmailMacroEvent,
        ProjectMacroEvent,
        PropertyMacroEvent,
);

/// Number of sequential workers events are sharded across by ordering key.
///
/// Each in-flight event holds a database connection and an OpenSearch
/// request, so this also bounds the consumer's downstream concurrency.
const WORKER_COUNT: usize = 10;
/// Maximum number of decoded events waiting for each sequential worker.
///
/// Offsets are committed at handoff, so `WORKER_COUNT * WORKER_CHANNEL_CAPACITY`
/// also bounds how many committed-but-unprocessed events a crash can drop.
const WORKER_CHANNEL_CAPACITY: usize = 16;
/// Delay before polling Kafka again after a receive error.
const RECEIVE_ERROR_RETRY_DELAY: Duration = Duration::from_secs(1);
/// Total processing attempts before an event is dropped.
const MAX_PROCESSING_ATTEMPTS: u32 = 3;
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

/// Sharding key that serializes all events mutating the same search documents.
///
/// Every topic's producer key is already the entity its index actions target
/// (calendar-event, call, channel, chat, document, project, or property-entity
/// id), except email events, which are produced with a link-scoped key and
/// instead shard by thread so one inbox's backlog can spread across the worker
/// pool.
fn ordering_key(event: &DeclaredMacroEvent) -> Cow<'_, str> {
    match event {
        DeclaredMacroEvent::CalendarMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::CallMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::ChannelMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::ChatMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::DocumentMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::EmailMacroEvent(event) => email_ordering_key(event),
        DeclaredMacroEvent::ProjectMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::PropertyMacroEvent(event) => Cow::Borrowed(event.key()),
    }
}

/// Fixed pool of sequential workers, sharded by [`ordering_key`].
///
/// Events with the same ordering key always land on the same worker's FIFO
/// channel, so they process in handoff (partition) order; events with
/// different keys may process concurrently.
struct WorkerPool {
    senders: Vec<mpsc::Sender<ReceivedEvent>>,
}

impl WorkerPool {
    fn new(senders: Vec<mpsc::Sender<ReceivedEvent>>) -> Self {
        assert!(
            !senders.is_empty(),
            "worker pool requires at least one worker"
        );
        Self { senders }
    }

    /// Spawns [`WORKER_COUNT`] workers sharing `context` and returns their
    /// join handles alongside the pool. Dropping the pool closes every worker
    /// channel, letting the workers drain and exit.
    fn spawn(context: &KafkaProcessingContext) -> (Self, Vec<JoinHandle<()>>) {
        let (senders, workers) = (0..WORKER_COUNT)
            .map(|_| {
                let (sender, receiver) = mpsc::channel(WORKER_CHANNEL_CAPACITY);
                (
                    sender,
                    tokio::spawn(run_event_worker(context.clone(), receiver)),
                )
            })
            .unzip();
        (Self::new(senders), workers)
    }

    fn shard_index(&self, key: &str) -> usize {
        let mut hasher = DefaultHasher::new();
        key.hash(&mut hasher);
        (hasher.finish() % self.senders.len() as u64) as usize
    }

    async fn handoff<E>(&self, decoded: Result<ReceivedEvent, E>) -> HandoffOutcome<E> {
        let event = match decoded {
            Ok(event) => event,
            Err(error) => return HandoffOutcome::MalformedRecord(error),
        };

        let shard = self.shard_index(ordering_key(&event.event).as_ref());
        match self.senders[shard].send(event).await {
            Ok(()) => HandoffOutcome::HandedOff,
            Err(_) => HandoffOutcome::WorkerClosed,
        }
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
        DeclaredMacroEvent::CalendarMacroEvent(event) => {
            if !context.calendar_search_enabled {
                // The offset is committed either way, so a change that arrives
                // while the flag is off is not replayed when it flips — the
                // backfill endpoint is how an enabled environment catches up.
                tracing::debug!(
                    partition,
                    offset,
                    "calendar search is disabled; skipping calendar event"
                );
                return EventOutcome::Ignored;
            }
            process_calendar_event(context, event, partition, offset).await
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
        DeclaredMacroEvent::EmailMacroEvent(event) => {
            process_email_event(db, opensearch_client, event, partition, offset).await
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
    workers: WorkerPool,
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

                match workers.handoff(decoded).await {
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

/// Runs the bounded broker event poll loop and worker pool until `shutdown`
/// resolves.
///
/// The caller is responsible for supervising this function. A closed worker
/// channel returns an error without committing the current Kafka message. On
/// normal shutdown the senders are dropped and all buffered events are
/// processed before this function returns.
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

    let (pool, workers) = WorkerPool::spawn(&context);
    // Passing the pool by value drops every sender when polling stops, which
    // closes the worker channels so the workers drain and exit.
    let poll_result = poll_events(&consumer, pool, shutdown).await;

    let mut worker_failure = None;
    for worker in workers {
        if let Err(error) = worker.await {
            worker_failure = Some(error);
        }
    }

    poll_result?;
    if let Some(error) = worker_failure {
        Err(rootcause::report!(error))?;
    }
    Ok(())
}
