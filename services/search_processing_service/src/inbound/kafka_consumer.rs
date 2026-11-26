//! Kafka consumer for broker events that update the search index.
//!
//! Each task runs one group member per [`Lane`]: email, and every other
//! topic. A member owns its poll loop, workers and offsets, so an email
//! backlog cannot hold up the other topics.
//!
//! The poll loop shards each decoded event by its ordering key onto one of a
//! fixed pool of bounded, sequential workers and commits the offset
//! immediately after that handoff. Events sharing an ordering key — the
//! entity whose search documents they mutate — stay on one worker in
//! partition order; unrelated events process in parallel. An event that only
//! rereads its entity is committed without a handoff while a reread for that
//! entity is already queued, so one busy entity cannot fill its worker's
//! channel and stall every topic in its lane. Malformed records are committed without a
//! handoff so they cannot wedge a partition.
//! Processing is retried in-process, longer while OpenSearch refuses writes
//! ([`attempts`]); an event whose attempts fail is queued on the search event
//! queue and replayed a minute later ([`replay`]), because its offset is
//! already committed. It is dropped only when that queueing fails too. A
//! graceful stop gives the
//! workers a few seconds, then commits each partition it still owns back to its
//! first record no worker started ([`offsets`]), so a scale-in or deploy
//! redelivers the events still queued instead of losing them. Events a worker
//! had started are not redelivered, so one that hangs or kills its worker is
//! not retried on every stop.
//!
//! Per-entity event mapping and processing live in the [`calendar_event`],
//! [`call`], [`channel`], [`chat`], [`document`], [`email`], [`project`], and
//! [`property`] submodules; this module owns the poll loop, worker, retry
//! policy, and commit semantics.

#![allow(clippy::enum_variant_names)]

mod agent_session;
mod attempts;
mod backlog;
mod calendar_event;
mod call;
mod channel;
mod chat;
mod context;
mod document;
mod email;
mod entity_type;
mod message;
mod metrics;
mod offsets;
mod project;
mod property;
mod replay;
mod scaling;
#[cfg(test)]
mod test;

use std::{
    borrow::Cow,
    collections::{HashSet, hash_map::DefaultHasher},
    future::Future,
    hash::{Hash as _, Hasher as _},
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use ::agent_session::domain::events::AgentSessionLifecycleMacroEvent;
use ::call::domain::events::CallMacroEvent;
use ::chat::domain::events::ChatMacroEvent;
use ::email::domain::events::EmailMacroEvent;
use calendar_events::domain::events::CalendarMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use kafka_util::{
    GroupName, InitialOffset, KafkaEventConsumer, Prefetch, consumer_span, record_span_error,
};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection, MacroEventConsumerService,
};
use messages::outbound::broker::MessageMacroEvent;
use projects::domain::events::ProjectMacroEvent;
use properties::domain::events::PropertyMacroEvent;
use rdkafka::{
    Offset, TopicPartitionList,
    consumer::CommitMode,
    message::{BorrowedMessage, Message as _},
};
use rootcause::prelude::{Report, ResultExt as _};
use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
    time::MissedTickBehavior,
};
use tokio_util::sync::CancellationToken;
use tracing::{Instrument as _, field};
use uuid::Uuid;

use self::{
    attempts::{Attempted, Attempts, Exhausted, Failure, Handled},
    backlog::{BacklogSampler, SAMPLE_INTERVAL},
    calendar_event::process_calendar_event,
    call::{describe_call_event, process_call_event},
    channel::{describe_channel_event, process_channel_event},
    chat::{describe_chat_event, process_chat_event},
    document::{describe_document_event, process_document_event},
    email::{describe_email_event, email_ordering_key, process_email_event},
    entity_type::EntityType,
    message::{describe_message_event, process_message_event},
    offsets::{OffsetLedger, RecordPosition, WorkerReport},
    project::{describe_project_event, process_project_event},
    property::{describe_property_event, process_property_event},
    replay::{ReplayQueue, conclude_kafka_attempts},
};

use self::metrics::Loss;
pub(crate) use self::{
    context::KafkaProcessingContext,
    metrics::IndexMetrics,
    replay::{ReplayDone, replay_broker_event},
    scaling::publish_lane_backlog,
};

/// Consumer group used for live search-index event offsets.
pub(crate) struct SearchProcessingConsumerGroup;

impl GroupName for SearchProcessingConsumerGroup {
    const GROUP_NAME: &'static str = "search-processing-service";
    // `macro.messages` joined this group's subscription with no committed
    // offset; starting at its head avoids replaying the topic's retention.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
    // A lane's topics reach its poll loop through one queue, so with
    // librdkafka's defaults a record waited behind up to 100,000 prefetched
    // records of a busier topic; before email had a lane of its own, about an
    // hour of an email backlog at production's pace.
    const PREFETCH: Prefetch = Prefetch::Bounded {
        records: 10,
        partition_bytes: 8 * 1024,
    };
}

/// One member of the consumer group, reading one [`Lane`]'s topics.
type LaneConsumer<L> =
    MacroEventConsumerService<L, KafkaConsumerAdapter<SearchProcessingConsumerGroup, L>>;

macro_event_broker::declare_topics!(
    DeclaredMacroEvent:
        AgentSessionLifecycleMacroEvent,
        CalendarMacroEvent,
        CallMacroEvent,
        ChannelMacroEvent,
        ChatMacroEvent,
        DocumentMacroEvent,
        EmailMacroEvent,
        MessageMacroEvent,
        ProjectMacroEvent,
        PropertyMacroEvent,
);

macro_event_broker::declare_topics!(EmailLaneEvent: EmailMacroEvent);

macro_event_broker::declare_topics!(
    LiveLaneEvent:
        AgentSessionLifecycleMacroEvent,
        CalendarMacroEvent,
        CallMacroEvent,
        ChannelMacroEvent,
        ChatMacroEvent,
        DocumentMacroEvent,
        MessageMacroEvent,
        ProjectMacroEvent,
        PropertyMacroEvent,
);

/// The topics one group member reads into its own poll loop and workers, so
/// an email backlog never holds up the other topics.
///
/// Each process runs one member per lane in the same group, so the group's
/// committed offsets carry over and each topic's partitions are shared among
/// the tasks' members for its lane.
pub(crate) trait Lane:
    MacroEventCollection + Into<DeclaredMacroEvent> + Send + 'static
{
    /// The lane's name, as the backlog metrics name it.
    const NAME: &'static str;
}

impl Lane for EmailLaneEvent {
    const NAME: &'static str = "email";
}

impl Lane for LiveLaneEvent {
    const NAME: &'static str = "live";
}

/// Holds each lane's member in the group until every lane has committed back
/// what it queued, so a stopping task leaves the group once.
///
/// A member leaving first rebalances the group while the other lane still
/// drains, and every task's members then wait for that drain, since a member
/// that is not polling cannot rejoin.
#[derive(Clone, Debug)]
pub(crate) struct LeaveTogether(Arc<watch::Sender<usize>>);

impl LeaveTogether {
    /// For `lanes` members, one per lane.
    pub(crate) fn new(lanes: usize) -> Self {
        Self(Arc::new(watch::channel(lanes).0))
    }

    /// Marks one lane's rewind done, then waits until every lane's is, or
    /// until `deadline` for a lane that is not running.
    async fn rewound(&self, deadline: tokio::time::Instant) {
        self.0.send_modify(|left| *left = left.saturating_sub(1));
        let mut left = self.0.subscribe();
        let _ = tokio::time::timeout_at(deadline, left.wait_for(|left| *left == 0)).await;
    }
}

impl From<EmailLaneEvent> for DeclaredMacroEvent {
    fn from(event: EmailLaneEvent) -> Self {
        match event {
            EmailLaneEvent::EmailMacroEvent(event) => Self::EmailMacroEvent(event),
        }
    }
}

impl From<LiveLaneEvent> for DeclaredMacroEvent {
    fn from(event: LiveLaneEvent) -> Self {
        match event {
            LiveLaneEvent::AgentSessionLifecycleMacroEvent(event) => {
                Self::AgentSessionLifecycleMacroEvent(event)
            }
            LiveLaneEvent::CalendarMacroEvent(event) => Self::CalendarMacroEvent(event),
            LiveLaneEvent::CallMacroEvent(event) => Self::CallMacroEvent(event),
            LiveLaneEvent::ChannelMacroEvent(event) => Self::ChannelMacroEvent(event),
            LiveLaneEvent::ChatMacroEvent(event) => Self::ChatMacroEvent(event),
            LiveLaneEvent::DocumentMacroEvent(event) => Self::DocumentMacroEvent(event),
            LiveLaneEvent::MessageMacroEvent(event) => Self::MessageMacroEvent(event),
            LiveLaneEvent::ProjectMacroEvent(event) => Self::ProjectMacroEvent(event),
            LiveLaneEvent::PropertyMacroEvent(event) => Self::PropertyMacroEvent(event),
        }
    }
}

/// Number of sequential workers each lane shards its events across by
/// ordering key.
///
/// Each in-flight event holds a database connection and an OpenSearch
/// request, so a task's two lanes hold at most twice this many.
const WORKER_COUNT: usize = 10;
/// Maximum number of decoded events waiting for each sequential worker.
///
/// Offsets are committed at handoff, so a crash can drop up to
/// `WORKER_COUNT * WORKER_CHANNEL_CAPACITY` queued events, plus the events
/// each queued reread absorbed. A graceful stop
/// redelivers the queued ones: see [`SHUTDOWN_DRAIN_DEADLINE`].
const WORKER_CHANNEL_CAPACITY: usize = 16;
/// How long a gracefully stopping consumer lets the workers finish the events
/// they hold, half of the 10 s ECS gives a task after its stop signal. Then it
/// commits each partition it still owns back to its first record no worker
/// started, which its next owner redelivers.
const SHUTDOWN_DRAIN_DEADLINE: Duration = Duration::from_secs(5);
/// How long aborted workers get to stop, so their last start and finish
/// reports reach the ledger before it decides what to rewind.
const ABORT_GRACE: Duration = Duration::from_millis(500);
/// How long after its graceful stop begins a lane waits for the other lanes to
/// commit back before leaving the group: their drain and abort, plus a second
/// for the commit.
const LEAVE_TOGETHER_DEADLINE: Duration = SHUTDOWN_DRAIN_DEADLINE
    .saturating_add(ABORT_GRACE)
    .saturating_add(Duration::from_secs(1));
/// Delay before polling Kafka again after a receive error.
const RECEIVE_ERROR_RETRY_DELAY: Duration = Duration::from_secs(1);

/// A decoded search-processing event and its Kafka coordinates.
struct ReceivedEvent {
    event: DeclaredMacroEvent,
    topic: &'static str,
    partition: i32,
    offset: i64,
    /// Wire type of `event`, e.g. `email.thread_backfilled`.
    event_type: &'static str,
    /// When the broker recorded the event, in Unix milliseconds, if it did.
    produced_at_ms: Option<i64>,
    /// The record's key and payload as read, for a replay of the event.
    key: String,
    payload: String,
    delivery: Delivery,
    /// The record's `kafka.process` span, from receipt until processing ends,
    /// so its duration includes the wait in the worker channel. A replay's
    /// `search.replay_event` span.
    span: tracing::Span,
}

/// How an event reached processing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Delivery {
    /// Read from its topic.
    Kafka,
    /// Replayed from the search event queue after its attempts failed.
    SqsReplay,
}

impl ReceivedEvent {
    fn position(&self) -> RecordPosition {
        RecordPosition {
            topic: self.topic,
            partition: self.partition,
            offset: self.offset,
        }
    }
}

/// Outcome of one decoded broker event, recorded as the `outcome` field of
/// its `process_event` span.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum EventOutcome {
    /// The corresponding search-index operation succeeded.
    Indexed,
    /// The recognized event does not require a search-index operation.
    Ignored,
    /// The event's attempts failed and it was queued for a replay: late, not
    /// lost.
    RetryQueued,
    /// A replay failed and the queue delivers it again.
    Failed,
    /// The event's source is gone for good, or a replay found a row it needs
    /// still missing, so there is nothing left to apply.
    SourceMissing,
    /// Lost: a Kafka event whose attempts failed and whose replay could not be
    /// queued, or a replay that failed on its last delivery and moves to the
    /// dead-letter queue.
    Dropped,
    /// Committed without processing: a reread for the same entity was queued.
    Coalesced,
    /// The event changes nothing indexed: known at handoff, which commits it
    /// without processing, or found by its write, such as a property write
    /// for an entity the index does not hold yet.
    NoIndexChange,
}

impl From<Handled> for EventOutcome {
    fn from(handled: Handled) -> Self {
        match handled {
            Handled::Indexed => Self::Indexed,
            Handled::Ignored => Self::Ignored,
            Handled::NoIndexChange => Self::NoIndexChange,
            Handled::SourceMissing => Self::SourceMissing,
        }
    }
}

/// How one event's processing ended, recorded on its `process_event` span.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OutcomeRecord {
    outcome: EventOutcome,
    /// Why its last attempt failed, when one did.
    failure: Option<Failure>,
    attempts: u32,
    /// Items OpenSearch failed in the last attempt's bulk request.
    failed_items: u32,
}

impl OutcomeRecord {
    /// An event committed without an attempt.
    fn skipped(outcome: EventOutcome) -> Self {
        Self {
            outcome,
            failure: None,
            attempts: 0,
            failed_items: 0,
        }
    }

    fn handled(handled: Handled, attempts: u32) -> Self {
        Self {
            outcome: handled.into(),
            failure: None,
            attempts,
            failed_items: 0,
        }
    }

    fn failed(outcome: EventOutcome, exhausted: &Exhausted) -> Self {
        Self {
            outcome,
            failure: Some(exhausted.diagnosis.failure),
            attempts: exhausted.attempts,
            failed_items: exhausted.diagnosis.failed_items,
        }
    }
}

/// Result of decoding and attempting a channel handoff.
///
/// Successful handoffs, coalesced rereads, events that change nothing indexed,
/// and malformed records are safe to commit. A closed worker channel must leave the current record uncommitted so
/// supervision can restart the consumer and redeliver it.
#[derive(Debug)]
enum HandoffOutcome<E> {
    HandedOff,
    /// A reread for the same entity is already queued and has not started, so
    /// it will read state at least as new as this event.
    Coalesced,
    /// The event cannot change anything the search index holds.
    NoIndexChange,
    MalformedRecord(E),
    WorkerClosed,
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
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::CalendarMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::CallMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::ChannelMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::ChatMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::DocumentMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::EmailMacroEvent(event) => email_ordering_key(event),
        DeclaredMacroEvent::MessageMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::ProjectMacroEvent(event) => Cow::Borrowed(event.key()),
        DeclaredMacroEvent::PropertyMacroEvent(event) => Cow::Borrowed(event.key()),
    }
}

/// Whether processing `event` can change the search index.
fn changes_search_index(event: &DeclaredMacroEvent) -> bool {
    match event {
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => {
            agent_session::changes_search_projection(event)
        }
        DeclaredMacroEvent::CalendarMacroEvent(_)
        | DeclaredMacroEvent::CallMacroEvent(_)
        | DeclaredMacroEvent::ChannelMacroEvent(_)
        | DeclaredMacroEvent::ChatMacroEvent(_)
        | DeclaredMacroEvent::DocumentMacroEvent(_)
        | DeclaredMacroEvent::EmailMacroEvent(_)
        | DeclaredMacroEvent::MessageMacroEvent(_)
        | DeclaredMacroEvent::ProjectMacroEvent(_)
        | DeclaredMacroEvent::PropertyMacroEvent(_) => true,
    }
}

/// Key of an event whose processing only rereads its entity's current state,
/// so a queued reread already covers it.
fn coalescible_reread_key(event: &DeclaredMacroEvent) -> Option<String> {
    match event {
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => {
            Some(agent_session::reread_key(event))
        }
        DeclaredMacroEvent::EmailMacroEvent(event) => email::reread_key(event),
        DeclaredMacroEvent::CalendarMacroEvent(_)
        | DeclaredMacroEvent::CallMacroEvent(_)
        | DeclaredMacroEvent::ChannelMacroEvent(_)
        | DeclaredMacroEvent::ChatMacroEvent(_)
        | DeclaredMacroEvent::DocumentMacroEvent(_)
        | DeclaredMacroEvent::MessageMacroEvent(_)
        | DeclaredMacroEvent::ProjectMacroEvent(_)
        | DeclaredMacroEvent::PropertyMacroEvent(_) => None,
    }
}

/// Entities with a coalescible reread queued on a worker but not yet started.
///
/// While one reread for an entity waits in its worker's channel, later hints
/// for that entity add nothing: the queued reread starts after them and reads
/// newer state. Skipping them keeps one busy entity from filling its worker's
/// channel, which would stop handoff for every topic and partition in its
/// lane. Handing off any other event for the entity releases its claim: the
/// reread runs before that event, so it no longer covers a hint published
/// after it.
#[derive(Debug, Default)]
struct PendingRereads(Mutex<HashSet<String>>);

impl PendingRereads {
    /// Marks `key` queued; returns false when a reread for it already waits.
    fn claim(&self, key: String) -> bool {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key)
    }

    /// Clears `key` before its reread starts, so a hint arriving during the
    /// reread queues the next one.
    fn release(&self, key: &str) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(key);
    }
}

/// Fixed pool of sequential workers, sharded by [`ordering_key`].
///
/// Events with the same ordering key always land on the same worker's FIFO
/// channel, so they process in handoff (partition) order; events with
/// different keys may process concurrently.
struct WorkerPool {
    senders: Vec<mpsc::Sender<ReceivedEvent>>,
    pending_rereads: Arc<PendingRereads>,
    metrics: IndexMetrics,
}

impl WorkerPool {
    /// `pending_rereads` must be the set the workers draining `senders` release.
    fn new(
        senders: Vec<mpsc::Sender<ReceivedEvent>>,
        pending_rereads: Arc<PendingRereads>,
        metrics: IndexMetrics,
    ) -> Self {
        assert!(
            !senders.is_empty(),
            "worker pool requires at least one worker"
        );
        Self {
            senders,
            pending_rereads,
            metrics,
        }
    }

    /// Spawns [`WORKER_COUNT`] workers sharing `context` and returns their
    /// join handles alongside the pool. Each worker reports to `reports` when
    /// it starts and finishes a record and follows `stop`. Dropping the pool
    /// closes every worker channel, letting the workers drain and exit.
    fn spawn(
        context: &KafkaProcessingContext,
        reports: &mpsc::UnboundedSender<WorkerReport>,
        stop: &WorkerStop,
    ) -> (Self, Vec<JoinHandle<()>>) {
        let pending_rereads = Arc::new(PendingRereads::default());
        let (senders, workers) = (0..WORKER_COUNT)
            .map(|_| {
                let (sender, receiver) = mpsc::channel(WORKER_CHANNEL_CAPACITY);
                (
                    sender,
                    tokio::spawn(run_event_worker(
                        context.clone(),
                        receiver,
                        Arc::clone(&pending_rereads),
                        reports.clone(),
                        stop.clone(),
                    )),
                )
            })
            .unzip();
        (
            Self::new(senders, pending_rereads, context.metrics.clone()),
            workers,
        )
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
        // Before any reread claim: an event that changes nothing must not hold
        // one and absorb a later event that does.
        if !changes_search_index(&event.event) {
            record_outcome(
                &self.metrics,
                &processing_span(&event),
                &event,
                OutcomeRecord::skipped(EventOutcome::NoIndexChange),
            );
            return HandoffOutcome::NoIndexChange;
        }

        let shard = self.shard_index(ordering_key(&event.event).as_ref());
        let sender = &self.senders[shard];
        // A dead worker may still hold a claim for a reread it will never run;
        // leave the record uncommitted so a restart redelivers it.
        if sender.is_closed() {
            return HandoffOutcome::WorkerClosed;
        }
        let reread_key = coalescible_reread_key(&event.event);
        if let Some(key) = &reread_key
            && !self.pending_rereads.claim(key.clone())
        {
            record_outcome(
                &self.metrics,
                &processing_span(&event),
                &event,
                OutcomeRecord::skipped(EventOutcome::Coalesced),
            );
            return HandoffOutcome::Coalesced;
        }
        if reread_key.is_none() {
            self.pending_rereads
                .release(ordering_key(&event.event).as_ref());
        }

        match sender.send(event).await {
            Ok(()) => HandoffOutcome::HandedOff,
            Err(_) => {
                if let Some(key) = &reread_key {
                    self.pending_rereads.release(key);
                }
                HandoffOutcome::WorkerClosed
            }
        }
    }
}

fn attach_event_coordinates<E>(
    decoded: Result<DeclaredMacroEvent, E>,
    partition: i32,
    offset: i64,
    span: tracing::Span,
) -> Result<ReceivedEvent, E> {
    decoded.map(|event| ReceivedEvent {
        event_type: event_type(&event),
        topic: event_topic(&event),
        event,
        partition,
        offset,
        produced_at_ms: None,
        key: String::new(),
        payload: String::new(),
        delivery: Delivery::Kafka,
        span,
    })
}

/// Opens a record's `kafka.process` span, decodes the record inside it, and
/// attaches the span, with the record's coordinates, to the decoded event.
/// The span is returned on its own too, so a record that failed to decode can
/// still be marked failed.
fn receive_record<M: rdkafka::Message, E>(
    message: &M,
    decode: impl FnOnce() -> Result<DeclaredMacroEvent, E>,
) -> (tracing::Span, Result<ReceivedEvent, E>) {
    let span = consumer_span(message, SearchProcessingConsumerGroup::GROUP_NAME);
    let decoded = span.in_scope(decode);
    let received =
        attach_event_coordinates(decoded, message.partition(), message.offset(), span.clone()).map(
            |received| ReceivedEvent {
                produced_at_ms: message.timestamp().to_millis(),
                // A decoded record's key and payload are UTF-8: the payload
                // is JSON and the key an entity id.
                key: String::from_utf8_lossy(message.key().unwrap_or_default()).into_owned(),
                payload: String::from_utf8_lossy(message.payload().unwrap_or_default())
                    .into_owned(),
                // The offset ledger keys the record by the topic it arrived
                // on, so its start and finish reports match its receipt.
                topic: subscribed_topic(message.topic()).unwrap_or(received.topic),
                ..received
            },
        );
    if let Ok(received) = &received {
        record_event_identity(&span, received);
    }
    (span, received)
}

/// The search entity an event acts on, safe to record: every producer key
/// except entity properties', which can name a user.
fn entity_id(event: &DeclaredMacroEvent) -> Option<Cow<'_, str>> {
    match event {
        DeclaredMacroEvent::PropertyMacroEvent(_) => None,
        _ => Some(ordering_key(event)),
    }
}

/// The event's wire type, e.g. `email.thread_backfilled`.
fn event_type(event: &DeclaredMacroEvent) -> &'static str {
    match event {
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => event.event().event.name(),
        DeclaredMacroEvent::CalendarMacroEvent(event) => {
            calendar_event::index_action(&event.event().event).1
        }
        DeclaredMacroEvent::CallMacroEvent(event) => {
            describe_call_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            describe_channel_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::ChatMacroEvent(event) => {
            describe_chat_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            describe_document_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::EmailMacroEvent(event) => {
            describe_email_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::MessageMacroEvent(event) => {
            describe_message_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::ProjectMacroEvent(event) => {
            describe_project_event(&event.event().event).event_type
        }
        DeclaredMacroEvent::PropertyMacroEvent(event) => {
            describe_property_event(&event.event().event).event_type
        }
    }
}

/// The topic the event arrives on.
fn event_topic(event: &DeclaredMacroEvent) -> &'static str {
    match event {
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::CalendarMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::CallMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::ChannelMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::ChatMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::DocumentMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::EmailMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::MessageMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::ProjectMacroEvent(event) => event.topic(),
        DeclaredMacroEvent::PropertyMacroEvent(event) => event.topic(),
    }
}

/// The subscribed topic named `topic`, as the static name the offset ledger keys on.
fn subscribed_topic(topic: &str) -> Option<&'static str> {
    DeclaredMacroEvent::topics()
        .iter()
        .copied()
        .find(|subscribed| *subscribed == topic)
}

fn event_id(event: &DeclaredMacroEvent) -> Uuid {
    match event {
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::CalendarMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::CallMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::ChannelMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::ChatMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::DocumentMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::EmailMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::MessageMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::ProjectMacroEvent(event) => event.event().event_id,
        DeclaredMacroEvent::PropertyMacroEvent(event) => event.event().event_id,
    }
}

/// Records which event a record's `kafka.process` span carries.
fn record_event_identity(span: &tracing::Span, received: &ReceivedEvent) {
    span.record("macro.event.id", field::display(event_id(&received.event)));
    span.record("macro.event.type", received.event_type);
    if let DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) = &received.event {
        span.record(
            "agent.session.id",
            field::display(event.event().event.session_id()),
        );
    }
}

/// The `process_event` span for one record: the processing phase under its
/// `kafka.process` span. `record_age_ms` is how long after the broker recorded
/// the event processing began, the search index's lag for that entity.
fn processing_span(received: &ReceivedEvent) -> tracing::Span {
    let record_age_ms = received
        .produced_at_ms
        .map(|produced_at| chrono::Utc::now().timestamp_millis() - produced_at);
    tracing::info_span!(
        parent: &received.span,
        "process_event",
        partition = received.partition,
        offset = received.offset,
        event_type = received.event_type,
        entity_type = <&'static str>::from(EntityType::of(&received.event)),
        entity_id = entity_id(&received.event).as_deref(),
        delivery = <&'static str>::from(received.delivery),
        record_age_ms,
        outcome = field::Empty,
        failure = field::Empty,
        attempts = field::Empty,
        failed_items = field::Empty,
        otel.status_code = field::Empty,
    )
}

/// Records how `received` ended on its `process_event` span and in `metrics`.
fn record_outcome(
    metrics: &IndexMetrics,
    span: &tracing::Span,
    received: &ReceivedEvent,
    record: OutcomeRecord,
) {
    span.record("outcome", <&'static str>::from(record.outcome));
    span.record("attempts", record.attempts);
    if let Some(failure) = record.failure {
        span.record("failure", <&'static str>::from(failure));
        span.record("failed_items", record.failed_items);
    }
    if record.outcome == EventOutcome::Dropped {
        span.record("otel.status_code", "ERROR");
    }
    metrics.record_processed(received, record);
}

/// Runs one record's processing inside its spans and records the outcome. An
/// event whose attempts fail is queued on `replays`. A dropped event also fails
/// the record's span, the consumer's top-level span, so drops count in the
/// service's error rate.
async fn process_received<'a, F, Fut, Q>(
    metrics: &IndexMetrics,
    received: &'a ReceivedEvent,
    replays: &Q,
    process: F,
) where
    F: FnOnce(&'a ReceivedEvent) -> Fut,
    Fut: Future<Output = Attempted>,
    Q: ReplayQueue,
{
    let span = processing_span(received);
    // A span ends at its last exit, so the record's span is entered again
    // here to cover the processing it waited for.
    let record = async {
        let attempted = process(received).await;
        conclude_kafka_attempts(received, attempted, replays).await
    }
    .instrument(span.clone())
    .instrument(received.span.clone())
    .await;
    record_outcome(metrics, &span, received, record);
    if record.outcome == EventOutcome::Dropped {
        record_span_error(&received.span, "event dropped after its processing retries");
    }
}

async fn process_event(
    context: &KafkaProcessingContext,
    event: &DeclaredMacroEvent,
    partition: i32,
    offset: i64,
    attempts: &Attempts,
) -> Attempted {
    let db = &context.db;
    let opensearch_client = context.opensearch_client.as_ref();

    match event {
        DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event) => {
            agent_session::process_agent_session_event(context, event, attempts).await
        }
        DeclaredMacroEvent::CallMacroEvent(event) => {
            process_call_event(db, opensearch_client, event, partition, offset, attempts).await
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
                return Ok((Handled::Ignored, 0));
            }
            process_calendar_event(context, event, partition, offset, attempts).await
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            process_channel_event(db, opensearch_client, event, partition, offset, attempts).await
        }
        DeclaredMacroEvent::ChatMacroEvent(event) => {
            process_chat_event(db, opensearch_client, event, partition, offset, attempts).await
        }
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            process_document_event(context, event, partition, offset, attempts).await
        }
        DeclaredMacroEvent::MessageMacroEvent(event) => {
            process_message_event(db, opensearch_client, event, partition, offset, attempts).await
        }
        DeclaredMacroEvent::EmailMacroEvent(event) => {
            process_email_event(
                db,
                opensearch_client,
                &context.mailbox_deletes,
                event,
                partition,
                offset,
                attempts,
            )
            .await
        }
        DeclaredMacroEvent::ProjectMacroEvent(event) => {
            process_project_event(db, opensearch_client, event, partition, offset, attempts).await
        }
        DeclaredMacroEvent::PropertyMacroEvent(event) => {
            process_property_event(db, opensearch_client, event, partition, offset, attempts).await
        }
    }
}

async fn run_event_worker(
    context: KafkaProcessingContext,
    events: mpsc::Receiver<ReceivedEvent>,
    pending_rereads: Arc<PendingRereads>,
    reports: mpsc::UnboundedSender<WorkerReport>,
    stop: WorkerStop,
) {
    let context = &context;
    let WorkerStop {
        stopping,
        rewinding,
    } = stop;
    let attempts = &Attempts::Retry { stopping };
    drain_worker_events(
        events,
        pending_rereads,
        reports,
        rewinding,
        |received| async move {
            process_received(
                &context.metrics,
                &received,
                context.replays.as_ref(),
                |received| {
                    process_event(
                        context,
                        &received.event,
                        received.partition,
                        received.offset,
                        attempts,
                    )
                },
            )
            .await;
        },
    )
    .await;
    tracing::trace!("search processing event worker drained");
}

/// Processes one worker's events in order until its channel closes, reporting
/// each record to `reports` as it starts and once it is processed.
///
/// A reread's claim is released as it is dequeued, before `process` reads
/// anything, so an event that arrives mid-reread queues the next one.
async fn drain_worker_events<F, Fut>(
    mut events: mpsc::Receiver<ReceivedEvent>,
    pending_rereads: Arc<PendingRereads>,
    reports: mpsc::UnboundedSender<WorkerReport>,
    rewinding: CancellationToken,
    mut process: F,
) where
    F: FnMut(ReceivedEvent) -> Fut,
    Fut: Future<Output = ()>,
{
    while let Some(received) = events.recv().await {
        // Once a graceful stop rewinds the partitions, a record left unstarted
        // is redelivered; one started now could be cut off and lost.
        if rewinding.is_cancelled() {
            break;
        }
        if let Some(key) = coalescible_reread_key(&received.event) {
            pending_rereads.release(&key);
        }
        let position = received.position();
        // The consumer stops listening only after giving up on the workers,
        // so a closed channel needs no handling here.
        let _ = reports.send(WorkerReport::Started(position));
        process(received).await;
        let _ = reports.send(WorkerReport::Done(position));
    }
}

fn commit_logged<L: Lane>(consumer: &LaneConsumer<L>, message: &BorrowedMessage<'_>) {
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

/// Updates `ledger` for a record whose handoff ended in `outcome`. A handed-off
/// record stays open until its worker reports it; a coalesced, malformed or
/// index-irrelevant one is finished now; a record the closed worker never took
/// stays open.
fn track_handoff<E>(
    ledger: &mut OffsetLedger,
    position: RecordPosition,
    outcome: &HandoffOutcome<E>,
) {
    match outcome {
        HandoffOutcome::HandedOff | HandoffOutcome::WorkerClosed => {}
        HandoffOutcome::Coalesced
        | HandoffOutcome::NoIndexChange
        | HandoffOutcome::MalformedRecord(_) => ledger.skipped(position),
    }
}

/// Waits for a record's `handoff`, which a full worker channel holds. The wait
/// is a stall, so worker reports still reach `ledger` and pending ages are
/// still sampled meanwhile. Returns `None` if `shutdown` resolves first,
/// without waiting: the record was never committed and stays open.
async fn await_handoff<T>(
    handoff: impl Future<Output = T>,
    shutdown: &mut (impl Future<Output = ()> + Unpin),
    sample_tick: &mut tokio::time::Interval,
    reports: &mut mpsc::UnboundedReceiver<WorkerReport>,
    ledger: &mut OffsetLedger,
    mut sample: impl FnMut(&OffsetLedger),
) -> Option<T> {
    let mut handoff = std::pin::pin!(handoff);
    loop {
        tokio::select! {
            biased;
            _ = &mut *shutdown => return None,
            outcome = &mut handoff => return Some(outcome),
            _ = sample_tick.tick() => sample(ledger),
            Some(report) = reports.recv() => ledger.report(report),
        }
    }
}

/// How polling ended.
struct PollEnd {
    result: Result<(), Report>,
    /// The record polling took and left uncommitted, which the group
    /// redelivers whatever the stop does with its partition.
    uncommitted: Option<RecordPosition>,
}

async fn poll_events<L: Lane>(
    consumer: &LaneConsumer<L>,
    workers: WorkerPool,
    ledger: &mut OffsetLedger,
    reports: &mut mpsc::UnboundedReceiver<WorkerReport>,
    shutdown: impl Future<Output = ()> + Send,
) -> PollEnd {
    let mut shutdown = std::pin::pin!(shutdown);
    let mut uncommitted = None;
    let mut sampler = BacklogSampler::new(workers.metrics.pending_ages().clone());
    let mut sample_tick = tokio::time::interval(SAMPLE_INTERVAL);
    sample_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = &mut shutdown => {
                tracing::info!("search processing event consumer shutting down");
                break;
            }
            _ = sample_tick.tick() => sampler.sample_consumer(consumer, ledger),
            Some(report) = reports.recv() => {
                ledger.report(report);
                while let Ok(report) = reports.try_recv() {
                    ledger.report(report);
                }
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(_) => { // error is logged in tracing automatically
                        tokio::select! {
                            biased;
                            _ = &mut shutdown => {
                                tracing::info!("search processing event consumer shutting down");
                                break;
                            }
                            () = tokio::time::sleep(RECEIVE_ERROR_RETRY_DELAY) => continue,
                        }
                    }
                };
                let kafka_message = message.inner();
                let (span, decoded) =
                    receive_record(kafka_message, || message.decode_payload().map(Into::into));
                let position = subscribed_topic(rdkafka::Message::topic(kafka_message)).map(|topic| {
                    RecordPosition {
                        topic,
                        partition: kafka_message.partition(),
                        offset: kafka_message.offset(),
                    }
                });
                if let Some(position) = position {
                    ledger.received(position, kafka_message.timestamp().to_millis());
                }

                let Some(outcome) = await_handoff(
                    workers.handoff(decoded).instrument(span.clone()),
                    &mut shutdown,
                    &mut sample_tick,
                    reports,
                    ledger,
                    |ledger| sampler.sample_consumer(consumer, ledger),
                )
                .await else {
                    tracing::info!("search processing event consumer shutting down");
                    uncommitted = position;
                    break;
                };
                if let Some(position) = position {
                    track_handoff(ledger, position, &outcome);
                }
                match outcome {
                    HandoffOutcome::HandedOff
                    | HandoffOutcome::Coalesced
                    | HandoffOutcome::NoIndexChange => {}
                    HandoffOutcome::MalformedRecord(error) => {
                        record_span_error(&span, &error);
                        workers
                            .metrics
                            .record_loss(rdkafka::Message::topic(kafka_message), Loss::Undecodable);
                        tracing::error!(
                            parent: &span,
                            error = %error,
                            topic = rdkafka::Message::topic(kafka_message),
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "dropping undecodable search processing event"
                        );
                    }
                    HandoffOutcome::WorkerClosed => {
                        record_span_error(&span, "worker channel closed before handoff");
                        tracing::error!(
                            parent: &span,
                            topic = rdkafka::Message::topic(kafka_message),
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "search processing event worker channel closed; leaving offset uncommitted"
                        );
                        return PollEnd {
                            result: Err(rootcause::report!(
                                "search processing event worker channel closed for topic {} at partition {} offset {}",
                                rdkafka::Message::topic(kafka_message),
                                kafka_message.partition(),
                                kafka_message.offset(),
                            )),
                            uncommitted: position,
                        };
                    }
                }

                // Deliberately commit immediately after a successful handoff. The worker
                // owns retries and drops exhausted events without requesting redelivery.
                span.in_scope(|| commit_logged(consumer, kafka_message));
            }
        }
    }

    PollEnd {
        result: Ok(()),
        uncommitted,
    }
}

/// What committing back at a stop achieved.
#[derive(Debug, Default)]
struct Rewind {
    /// Partitions committed back to these records, which are redelivered.
    rewound: Vec<RecordPosition>,
    /// Queued records on partitions this consumer no longer owns.
    not_rewound: Vec<RecordPosition>,
    /// Queued records whose rewind failed, because the assignment or the
    /// commit did; whether the next owner reads them depends on the offset
    /// committed last.
    unconfirmed: Vec<RecordPosition>,
}

/// Commits each partition this consumer still owns back to its first record
/// no worker started, so its next owner redelivers it and what followed it.
/// Partitions it no longer owns are left to their owner.
fn rewind_queued<L: Lane>(consumer: &LaneConsumer<L>, ledger: &OffsetLedger) -> Rewind {
    let queued = ledger.queued();
    if queued.is_empty() {
        return Rewind::default();
    }
    let assigned = match consumer.inner().assignment() {
        Ok(assigned) => assigned,
        Err(error) => {
            tracing::error!(error = ?error, "could not read the consumer's assignment");
            return Rewind {
                unconfirmed: queued,
                ..Rewind::default()
            };
        }
    };
    let points = ledger
        .rewind_points(|topic, partition| assigned.find_partition(topic, partition).is_some());
    let mut offsets = TopicPartitionList::with_capacity(points.len());
    let mut rewound = Vec::with_capacity(points.len());
    for point in points {
        match offsets.add_partition_offset(
            point.topic,
            point.partition,
            Offset::Offset(point.offset),
        ) {
            Ok(()) => rewound.push(point),
            Err(error) => {
                tracing::error!(error = ?error, position = %point, "invalid search processing rewind offset")
            }
        }
    }
    let mut unconfirmed = Vec::new();
    if !rewound.is_empty()
        && let Err(error) = consumer.inner().commit_offsets(&offsets, CommitMode::Sync)
    {
        tracing::error!(error = ?error, "could not commit search processing partitions back to their queued events");
        unconfirmed = std::mem::take(&mut rewound);
    }
    let covered = |position: &RecordPosition, points: &[RecordPosition]| {
        points
            .iter()
            .any(|point| point.topic == position.topic && point.partition == position.partition)
    };
    let (unconfirmed, not_rewound) = queued
        .into_iter()
        .filter(|position| !covered(position, &rewound))
        .partition(|position| covered(position, &unconfirmed));
    Rewind {
        rewound,
        not_rewound,
        unconfirmed,
    }
}

/// What a stopping consumer asks of its workers.
#[derive(Clone, Default)]
struct WorkerStop {
    /// Cut short any wait between attempts.
    stopping: CancellationToken,
    /// Start no more records: the stop rewinds the partitions past them.
    rewinding: CancellationToken,
}

/// How the workers ended.
struct Drained {
    /// The first worker panic, even one that happened long before the stop.
    panic: Option<tokio::task::JoinError>,
    /// Workers still running at the deadline, and aborted.
    aborted: usize,
}

/// Waits for the workers to finish the events they hold, applying each
/// report to `ledger`. With a `deadline`, workers still running when it passes
/// are aborted; their records stay open.
async fn drain_workers(
    workers: Vec<JoinHandle<()>>,
    reports: &mut mpsc::UnboundedReceiver<WorkerReport>,
    ledger: &mut OffsetLedger,
    deadline: Option<Duration>,
) -> Drained {
    use futures::StreamExt as _;

    let aborts: Vec<_> = workers.iter().map(JoinHandle::abort_handle).collect();
    let mut running: futures::stream::FuturesUnordered<_> = workers.into_iter().collect();
    let mut timeout = std::pin::pin!(async {
        match deadline {
            Some(deadline) => tokio::time::sleep(deadline).await,
            None => std::future::pending().await,
        }
    });
    let mut panic = None;
    let mut timed_out = false;
    loop {
        tokio::select! {
            Some(report) = reports.recv() => ledger.report(report),
            finished = running.next() => match finished {
                Some(Err(error)) if error.is_panic() => {
                    panic.get_or_insert(error);
                }
                Some(_) => {}
                None => break,
            },
            () = &mut timeout => {
                timed_out = true;
                break;
            }
        }
    }
    let aborted = if timed_out { running.len() } else { 0 };
    if timed_out {
        for abort in aborts {
            abort.abort();
        }
        // An aborted worker stops at its next await; until then it can still
        // report, so wait briefly before the ledger is read.
        let _ = tokio::time::timeout(ABORT_GRACE, async {
            while let Some(finished) = running.next().await {
                if let Err(error) = finished
                    && error.is_panic()
                {
                    panic.get_or_insert(error);
                }
            }
        })
        .await;
    }
    while let Ok(report) = reports.try_recv() {
        ledger.report(report);
    }
    Drained { panic, aborted }
}

/// Runs the bounded broker event poll loop and worker pool until `shutdown`
/// resolves.
///
/// The caller is responsible for supervising this function. A closed worker
/// channel returns an error without committing the current Kafka message.
///
/// After a graceful stop the workers get [`SHUTDOWN_DRAIN_DEADLINE`] to finish
/// what they hold; any still running are aborted. Unless a worker panicked
/// during the run, each partition still assigned is then committed back to its
/// first record no worker started, so its next owner redelivers it. Records a
/// worker had started and did not finish are logged as lost, never rewound to.
/// After an error exit the workers drain fully, as before, and nothing is
/// rewound.
#[tracing::instrument(skip(context, leave, shutdown), fields(brokers, lane = L::NAME), err)]
pub(crate) async fn run_event_consumer<L: Lane>(
    brokers: &str,
    context: KafkaProcessingContext,
    leave: LeaveTogether,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<SearchProcessingConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<SearchProcessingConsumerGroup, ()>::new(consumer)
        .subscribe::<L>()
        .context("failed to subscribe to search processing event topics")?;
    let consumer = LaneConsumer::<L>::new(consumer);
    tracing::info!(
        topics = ?L::topics(),
        group = SearchProcessingConsumerGroup::GROUP_NAME,
        "search processing event consumer listening"
    );

    let (report_sender, mut reports) = mpsc::unbounded_channel();
    let stop = WorkerStop::default();
    let (pool, workers) = WorkerPool::spawn(&context, &report_sender, &stop);
    // Only the workers hold senders now, so `reports` closes once they all exit.
    drop(report_sender);
    let mut ledger = OffsetLedger::default();
    // Passing the pool by value drops every sender when polling stops, which
    // closes the worker channels so the workers drain and exit.
    let PollEnd {
        result: poll_result,
        uncommitted,
    } = poll_events(&consumer, pool, &mut ledger, &mut reports, shutdown).await;
    let stop_began = tokio::time::Instant::now();
    // A worker waiting to retry queues its event for a replay instead. After
    // a graceful stop it also starts no more records, which the rewind
    // redelivers; after an error nothing is rewound, so it drains them.
    stop.stopping.cancel();
    if poll_result.is_ok() {
        stop.rewinding.cancel();
    }

    let graceful = poll_result.is_ok();
    let span = tracing::info_span!(
        "kafka.consumer_stop",
        lane = L::NAME,
        graceful,
        drain_ms = field::Empty,
        aborted_workers = field::Empty,
        worker_panicked = field::Empty,
        lost = field::Empty,
        rewound_partitions = field::Empty,
        not_rewound = field::Empty,
        unconfirmed = field::Empty,
        leave_wait_ms = field::Empty,
    );
    let drained = async {
        let drain_started = std::time::Instant::now();
        let drained = drain_workers(
            workers,
            &mut reports,
            &mut ledger,
            graceful.then_some(SHUTDOWN_DRAIN_DEADLINE),
        )
        .await;
        let span = tracing::Span::current();
        span.record("drain_ms", u64::try_from(drain_started.elapsed().as_millis()).unwrap_or(u64::MAX));
        span.record("aborted_workers", drained.aborted);
        span.record("worker_panicked", drained.panic.is_some());

        let lost = ledger.started_unfinished();
        span.record("lost", lost.len());
        if !lost.is_empty() {
            tracing::warn!(
                events = %display_positions(&lost),
                "search processing events a worker had started were cut off by the stop; they are replayed only when a queued event before them on their partition is"
            );
        }
        if graceful && drained.panic.is_none() {
            let rewind = rewind_queued(&consumer, &ledger);
            for (record, loss) in losses_at_stop(&lost, Some(&rewind), &[], uncommitted) {
                context.metrics.record_loss(record.topic, loss);
            }
            span.record("rewound_partitions", rewind.rewound.len());
            span.record("not_rewound", rewind.not_rewound.len());
            span.record("unconfirmed", rewind.unconfirmed.len());
            if !rewind.rewound.is_empty() {
                tracing::info!(
                    partitions = %display_positions(&rewind.rewound),
                    "search processing partitions committed back to their first queued event; it and what follows are redelivered"
                );
            }
            if !rewind.not_rewound.is_empty() {
                tracing::warn!(
                    events = %display_positions(&rewind.not_rewound),
                    "queued search processing events on partitions this consumer no longer owns were not committed back"
                );
            }
            if !rewind.unconfirmed.is_empty() {
                tracing::warn!(
                    events = %display_positions(&rewind.unconfirmed),
                    "queued search processing events could not be committed back; check the group's committed offsets before a backfill"
                );
            }
        } else {
            let queued = ledger.queued();
            for (record, loss) in losses_at_stop(&lost, None, &queued, uncommitted) {
                context.metrics.record_loss(record.topic, loss);
            }
            span.record("not_rewound", queued.len());
            if !queued.is_empty() {
                tracing::warn!(
                    events = %display_positions(&queued),
                    "the consumer stopped after an error with queued events; those committed at handoff are not redelivered"
                );
            }
        }
        if graceful {
            let waiting = std::time::Instant::now();
            leave.rewound(stop_began + LEAVE_TOGETHER_DEADLINE).await;
            span.record(
                "leave_wait_ms",
                u64::try_from(waiting.elapsed().as_millis()).unwrap_or(u64::MAX),
            );
        }
        drained
    }
    .instrument(span)
    .await;
    // Closing polls librdkafka until it has left the group; both lanes close
    // at once, so keep that off the runtime's worker threads.
    let _ = tokio::task::spawn_blocking(move || drop(consumer)).await;

    poll_result?;
    if let Some(error) = drained.panic {
        Err(rootcause::report!(error))?;
    }
    Ok(())
}

/// The records a stop loses, which the group will not redeliver, with why.
///
/// `lost` were started and cut off; a partition committed back to an offset
/// at or before one replays it. After a `rewind`, the queued records it could
/// not commit back are lost; without one, every `queued` record is, since it
/// was committed at handoff. The `uncommitted` record never was, so it is
/// redelivered either way.
fn losses_at_stop(
    lost: &[RecordPosition],
    rewind: Option<&Rewind>,
    queued: &[RecordPosition],
    uncommitted: Option<RecordPosition>,
) -> Vec<(RecordPosition, Loss)> {
    let replayed = |record: &RecordPosition| {
        rewind.is_some_and(|rewind| {
            rewind.rewound.iter().any(|point| {
                point.topic == record.topic
                    && point.partition == record.partition
                    && point.offset <= record.offset
            })
        })
    };
    let cut_off = lost
        .iter()
        .filter(|record| !replayed(record))
        .map(|record| (*record, Loss::CutOffAtStop));
    let queued_losses: Vec<_> = match rewind {
        Some(rewind) => rewind
            .not_rewound
            .iter()
            .map(|record| (*record, Loss::NotRewound))
            .chain(
                rewind
                    .unconfirmed
                    .iter()
                    .map(|record| (*record, Loss::RewindUnconfirmed)),
            )
            .collect(),
        None => queued
            .iter()
            .map(|record| (*record, Loss::QueuedWithoutRewind))
            .collect(),
    };
    cut_off
        .chain(
            queued_losses
                .into_iter()
                .filter(|(record, _)| Some(*record) != uncommitted),
        )
        .collect()
}

fn display_positions(positions: &[RecordPosition]) -> String {
    positions
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}
