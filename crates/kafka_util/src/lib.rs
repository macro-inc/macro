#![deny(missing_docs)]
//! Environment-aware Kafka producer and consumer transports.
//!
//! These adapters centralize the repository's plaintext-local versus MSK-IAM
//! transport setup. Application inbound adapters retain responsibility for
//! decoding, retries, poison-message handling, and deciding when to commit.

#[cfg(test)]
mod test;

pub mod parallel;

use std::collections::{HashMap, HashSet};
use std::ffi::CString;
use std::marker::PhantomData;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use either::Either;
use macro_env::Environment;
use rdkafka::client::ClientContext;
use rdkafka::consumer::{
    BaseConsumer, CommitMode, Consumer, ConsumerContext, Rebalance, StreamConsumer,
};
use rdkafka::error::{KafkaError, KafkaResult};
use rdkafka::message::{BorrowedMessage, Message as _};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::types::RDKafkaErrorCode;
use rdkafka::{ClientConfig, Offset, TopicPartitionList};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use uuid::Uuid;

pub use msk_iam::{MskIamClientContext, configure_sasl_iam};

mod msk_iam;

const UNGROUPED_GROUP_PREFIX: &str = "macro-event-broker-independent";
const MESSAGE_TIMEOUT_MS: &str = "5000";
const COOPERATIVE_ASSIGNMENT_STRATEGY: &str = "cooperative-sticky";
const MAX_LIBRDKAFKA_POLL_INTERVAL_MS: u128 = 86_400_000;
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

/// Failure to construct an environment-specific Kafka consumer.
#[derive(Debug, thiserror::Error)]
pub enum KafkaConsumerError {
    /// Failed to create the unauthenticated local consumer.
    #[error("failed to create plaintext Kafka consumer")]
    Plaintext(#[source] KafkaError),
    /// Failed to create the TLS and MSK-IAM authenticated consumer.
    #[error("failed to create MSK IAM Kafka consumer")]
    MskIam(#[source] KafkaError),
    /// The max poll interval cannot be represented by librdkafka.
    #[error(
        "max poll interval {0:?} must round up to between 1 and \
         {MAX_LIBRDKAFKA_POLL_INTERVAL_MS} milliseconds"
    )]
    InvalidMaxPollInterval(Duration),
}

/// Failure to construct an environment-specific Kafka producer.
#[derive(Debug, thiserror::Error)]
pub enum KafkaProducerError {
    /// Failed to create the unauthenticated local producer.
    #[error("failed to create plaintext Kafka producer")]
    Plaintext(#[source] KafkaError),
    /// Failed to create the TLS and MSK-IAM authenticated producer.
    #[error("failed to create MSK IAM Kafka producer")]
    MskIam(#[source] KafkaError),
}

/// Underlying Kafka consumer transport selected from the runtime environment.
struct ConsumerTransport(
    Either<StreamConsumer<PlaintextConsumerContext>, StreamConsumer<MskIamClientContext>>,
);

/// Underlying Kafka producer transport selected from the runtime environment.
#[derive(Clone)]
struct ProducerTransport(Either<FutureProducer, FutureProducer<MskIamClientContext>>);

/// A Kafka topic and partition affected by a rebalance.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TopicPartition {
    /// Kafka topic name.
    pub topic: String,
    /// Kafka partition number.
    pub partition: i32,
}

/// Monotonically increasing ownership generation for one topic-partition.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AssignmentEpoch(u64);

impl AssignmentEpoch {
    /// Returns the integer generation value.
    pub fn value(self) -> u64 {
        self.0
    }
}

/// A topic-partition and its ownership generation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartitionAssignment {
    /// Topic and partition whose ownership changed.
    pub topic_partition: TopicPartition,
    /// Generation created by this ownership transition.
    pub epoch: AssignmentEpoch,
}

/// A synchronous group-rebalance state change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RebalanceEvent {
    /// Partitions assigned after librdkafka applied an incremental assignment.
    Assigned(Vec<PartitionAssignment>),
    /// Partitions fenced before librdkafka applies an incremental revocation.
    Revoked(Vec<PartitionAssignment>),
    /// Rebalance callback failure reported by librdkafka.
    Error(String),
}

#[derive(Default)]
struct RebalanceState {
    epochs: HashMap<TopicPartition, AssignmentEpoch>,
    assignments: HashMap<TopicPartition, AssignmentEpoch>,
}

struct RebalanceTrackerInner {
    state: Mutex<RebalanceState>,
    event_sender: UnboundedSender<RebalanceEvent>,
    event_receiver: Mutex<Option<UnboundedReceiver<RebalanceEvent>>>,
}

/// Tracks current partition ownership and publishes nonblocking rebalance events.
///
/// Revocations update the synchronous ownership snapshot before their event is
/// sent. A coordinator can therefore reject stale work immediately, even if it
/// has not yet received the asynchronous event.
#[derive(Clone)]
pub struct RebalanceTracker {
    inner: Arc<RebalanceTrackerInner>,
}

impl Default for RebalanceTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl RebalanceTracker {
    /// Creates an empty tracker with one asynchronous event receiver.
    pub fn new() -> Self {
        let (event_sender, event_receiver) = mpsc::unbounded_channel();
        Self {
            inner: Arc::new(RebalanceTrackerInner {
                state: Mutex::new(RebalanceState::default()),
                event_sender,
                event_receiver: Mutex::new(Some(event_receiver)),
            }),
        }
    }

    /// Takes the event receiver.
    ///
    /// Only one coordinator may consume a tracker's events. Later calls return
    /// `None`; synchronous state queries remain available on every clone.
    pub fn take_events(&self) -> Option<UnboundedReceiver<RebalanceEvent>> {
        lock_unpoisoned(&self.inner.event_receiver).take()
    }

    /// Returns a stable snapshot of currently owned topic-partitions.
    pub fn current_assignments(&self) -> Vec<PartitionAssignment> {
        let state = lock_unpoisoned(&self.inner.state);
        let mut assignments = state
            .assignments
            .iter()
            .map(|(topic_partition, epoch)| PartitionAssignment {
                topic_partition: topic_partition.clone(),
                epoch: *epoch,
            })
            .collect::<Vec<_>>();
        assignments.sort_by(|left, right| left.topic_partition.cmp(&right.topic_partition));
        assignments
    }

    pub(crate) fn assignment_epoch(&self, topic: &str, partition: i32) -> Option<AssignmentEpoch> {
        let state = lock_unpoisoned(&self.inner.state);
        state
            .assignments
            .get(&TopicPartition {
                topic: topic.to_string(),
                partition,
            })
            .copied()
    }

    pub(crate) fn with_current_assignment<Output>(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
        operation: impl FnOnce() -> Output,
    ) -> Option<Output> {
        let state = lock_unpoisoned(&self.inner.state);
        state
            .assignments
            .get(topic_partition)
            .is_some_and(|current_epoch| *current_epoch == epoch)
            .then(operation)
    }

    /// Returns whether `epoch` is the current ownership generation.
    pub fn is_current_assignment(
        &self,
        topic: &str,
        partition: i32,
        epoch: AssignmentEpoch,
    ) -> bool {
        let state = lock_unpoisoned(&self.inner.state);
        state
            .assignments
            .get(&TopicPartition {
                topic: topic.to_string(),
                partition,
            })
            .is_some_and(|current_epoch| *current_epoch == epoch)
    }

    fn observe_pre_rebalance(&self, rebalance: &Rebalance<'_>) {
        match rebalance {
            Rebalance::Revoke(partitions) => {
                let revoked = self.transition_partitions(partitions, false);
                let _ = self
                    .inner
                    .event_sender
                    .send(RebalanceEvent::Revoked(revoked));
            }
            Rebalance::Error(error) => {
                let _ = self
                    .inner
                    .event_sender
                    .send(RebalanceEvent::Error(error.to_string()));
            }
            Rebalance::Assign(_) => {}
        }
    }

    fn observe_post_rebalance(&self, rebalance: &Rebalance<'_>) {
        if let Rebalance::Assign(partitions) = rebalance {
            let assigned = self.transition_partitions(partitions, true);
            let _ = self
                .inner
                .event_sender
                .send(RebalanceEvent::Assigned(assigned));
        }
    }

    fn transition_partitions(
        &self,
        partitions: &TopicPartitionList,
        assigned: bool,
    ) -> Vec<PartitionAssignment> {
        let topic_partitions = unique_topic_partitions(partitions);
        let mut state = lock_unpoisoned(&self.inner.state);

        topic_partitions
            .into_iter()
            .map(|topic_partition| {
                let next_epoch = state.epochs.get(&topic_partition).map_or(1, |epoch| {
                    epoch
                        .0
                        .checked_add(1)
                        .expect("Kafka assignment epoch exhausted")
                });
                let epoch = AssignmentEpoch(next_epoch);
                state.epochs.insert(topic_partition.clone(), epoch);
                if assigned {
                    state.assignments.insert(topic_partition.clone(), epoch);
                } else {
                    state.assignments.remove(&topic_partition);
                }

                PartitionAssignment {
                    topic_partition,
                    epoch,
                }
            })
            .collect()
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn unique_topic_partitions(partitions: &TopicPartitionList) -> Vec<TopicPartition> {
    let mut seen = HashSet::new();
    partitions
        .elements()
        .into_iter()
        .filter_map(|element| {
            let topic_partition = TopicPartition {
                topic: element.topic().to_string(),
                partition: element.partition(),
            };
            seen.insert(topic_partition.clone())
                .then_some(topic_partition)
        })
        .collect()
}

#[derive(Default)]
struct PlaintextConsumerContext {
    rebalance_tracker: Option<RebalanceTracker>,
}

impl PlaintextConsumerContext {
    fn with_rebalance_tracker(rebalance_tracker: RebalanceTracker) -> Self {
        Self {
            rebalance_tracker: Some(rebalance_tracker),
        }
    }

    fn observe_pre_rebalance(&self, rebalance: &Rebalance<'_>) {
        if let Some(tracker) = &self.rebalance_tracker {
            tracker.observe_pre_rebalance(rebalance);
        }
    }

    fn observe_post_rebalance(&self, rebalance: &Rebalance<'_>) {
        if let Some(tracker) = &self.rebalance_tracker {
            tracker.observe_post_rebalance(rebalance);
        }
    }
}

impl ClientContext for PlaintextConsumerContext {}

impl ConsumerContext for PlaintextConsumerContext {
    fn pre_rebalance(&self, _consumer: &BaseConsumer<Self>, rebalance: &Rebalance<'_>) {
        self.observe_pre_rebalance(rebalance);
    }

    fn post_rebalance(&self, _consumer: &BaseConsumer<Self>, rebalance: &Rebalance<'_>) {
        self.observe_post_rebalance(rebalance);
    }
}

/// Type-level name for a durable Kafka consumer group.
///
/// Defining group names on marker types keeps group identities centralized and
/// prevents consumers from passing arbitrary string group IDs at construction.
pub trait GroupName {
    /// Stable Kafka consumer group ID used for partition balancing and offsets.
    const GROUP_NAME: &'static str;
}

/// Marker type for a consumer that does not subscribe or persist offsets.
///
/// librdkafka requires a configured `group.id` for its safe manual-assignment
/// API, so this mode uses a generated internal ID. It never exposes subscription
/// or commit operations and therefore does not create durable group state.
pub struct Ungrouped;

/// Starting position for manually assigned ungrouped topic partitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InitialOffset {
    /// Consume all currently retained records before continuing with new ones.
    Earliest,
    /// Consume only records published after the partition assignment begins.
    Latest,
}

impl InitialOffset {
    fn as_kafka_offset(self) -> Offset {
        match self {
            Self::Earliest => Offset::Beginning,
            Self::Latest => Offset::End,
        }
    }
}

/// Shared Kafka consumer with environment-aware transport and type-safe group behavior.
///
/// Consumers parameterized by a [`GroupName`] may subscribe and commit offsets.
/// [`Ungrouped`] consumers instead manually assign every partition of their
/// requested topics and cannot subscribe or commit.
pub struct KafkaEventConsumer<T> {
    consumer: ConsumerTransport,
    rebalance_tracker: Option<RebalanceTracker>,
    marker: PhantomData<T>,
}

/// Shared Kafka producer with environment-aware transport.
#[derive(Clone)]
pub struct KafkaEventProducer {
    producer: ProducerTransport,
}

fn base_config(brokers: &str) -> ClientConfig {
    let mut config = ClientConfig::new();
    config.set("bootstrap.servers", brokers);
    config
}

fn consumer_config(brokers: &str) -> ClientConfig {
    let mut config = base_config(brokers);
    config.set("enable.auto.commit", "false");
    config
}

fn producer_config(brokers: &str) -> ClientConfig {
    let mut config = base_config(brokers);
    config.set("message.timeout.ms", MESSAGE_TIMEOUT_MS);
    config
}

fn grouped_config<T: GroupName>(brokers: &str) -> ClientConfig {
    let mut config = consumer_config(brokers);
    config
        .set("group.id", T::GROUP_NAME)
        .set("auto.offset.reset", "earliest");
    config
}

fn grouped_config_with_max_poll_interval<T: GroupName>(
    brokers: &str,
    max_poll_interval: Duration,
) -> Result<ClientConfig, KafkaConsumerError> {
    let max_poll_interval_ms = librdkafka_millis(max_poll_interval)?;
    let mut config = grouped_config::<T>(brokers);
    config
        .set("max.poll.interval.ms", max_poll_interval_ms.to_string())
        .set(
            "partition.assignment.strategy",
            COOPERATIVE_ASSIGNMENT_STRATEGY,
        );
    Ok(config)
}

fn librdkafka_millis(duration: Duration) -> Result<u128, KafkaConsumerError> {
    let whole_milliseconds = duration.as_millis();
    let has_submillisecond_remainder = !duration.subsec_nanos().is_multiple_of(1_000_000);
    let milliseconds = whole_milliseconds + u128::from(has_submillisecond_remainder);

    if milliseconds == 0 || milliseconds > MAX_LIBRDKAFKA_POLL_INTERVAL_MS {
        return Err(KafkaConsumerError::InvalidMaxPollInterval(duration));
    }

    Ok(milliseconds)
}

fn ungrouped_config(brokers: &str) -> ClientConfig {
    let mut config = consumer_config(brokers);
    let group_id = format!("{UNGROUPED_GROUP_PREFIX}-{}", Uuid::new_v4());
    config
        .set("group.id", group_id)
        .set("enable.auto.offset.store", "false");
    config
}

fn create_consumer_from_env<T>(
    config: ClientConfig,
    rebalance_tracker: Option<RebalanceTracker>,
) -> Result<KafkaEventConsumer<T>, KafkaConsumerError> {
    let consumer = match Environment::new_or_prod() {
        Environment::Local => {
            let context = rebalance_tracker
                .clone()
                .map_or_else(PlaintextConsumerContext::default, |tracker| {
                    PlaintextConsumerContext::with_rebalance_tracker(tracker)
                });
            Either::Left(
                config
                    .create_with_context(context)
                    .map_err(KafkaConsumerError::Plaintext)?,
            )
        }
        Environment::Develop | Environment::Production => {
            let config = configure_sasl_iam(config);
            let context = rebalance_tracker.clone().map_or_else(
                MskIamClientContext::from_env,
                MskIamClientContext::from_env_with_rebalance_tracker,
            );
            Either::Right(
                config
                    .create_with_context(context)
                    .map_err(KafkaConsumerError::MskIam)?,
            )
        }
    };

    Ok(KafkaEventConsumer {
        consumer: ConsumerTransport(consumer),
        rebalance_tracker,
        marker: PhantomData,
    })
}

fn create_producer_from_env(
    config: ClientConfig,
) -> Result<KafkaEventProducer, KafkaProducerError> {
    let producer = match Environment::new_or_prod() {
        Environment::Local => Either::Left(config.create().map_err(KafkaProducerError::Plaintext)?),
        Environment::Develop | Environment::Production => {
            let config = configure_sasl_iam(config);
            Either::Right(
                config
                    .create_with_context(MskIamClientContext::from_env())
                    .map_err(KafkaProducerError::MskIam)?,
            )
        }
    };

    Ok(KafkaEventProducer {
        producer: ProducerTransport(producer),
    })
}

fn build_assignment<C, T>(
    consumer: &T,
    topics: &[&str],
    initial_offset: InitialOffset,
    metadata_timeout: Duration,
) -> KafkaResult<TopicPartitionList>
where
    C: ConsumerContext,
    T: Consumer<C>,
{
    if topics.is_empty() {
        return Err(KafkaError::Subscription(
            "at least one topic is required for assignment".to_string(),
        ));
    }

    let mut assignment = TopicPartitionList::new();
    for topic in topics {
        let metadata = consumer.fetch_metadata(Some(topic), metadata_timeout)?;
        let topic_metadata = metadata
            .topics()
            .iter()
            .find(|metadata| metadata.name() == *topic)
            .ok_or_else(|| {
                KafkaError::Subscription(format!(
                    "metadata response did not include requested topic {topic}"
                ))
            })?;

        if let Some(error) = topic_metadata.error() {
            return Err(KafkaError::MetadataFetch(error.into()));
        }
        if topic_metadata.partitions().is_empty() {
            return Err(KafkaError::Subscription(format!(
                "requested topic {topic} has no partitions"
            )));
        }

        for partition in topic_metadata.partitions() {
            if let Some(error) = partition.error() {
                return Err(KafkaError::MetadataFetch(error.into()));
            }
            assignment.add_partition_offset(
                topic,
                partition.id(),
                initial_offset.as_kafka_offset(),
            )?;
        }
    }

    Ok(assignment)
}

fn invalid_offset_error() -> KafkaError {
    KafkaError::SetPartitionOffset(RDKafkaErrorCode::InvalidArgument)
}

/// Converts a completed record offset to Kafka's next-offset commit value.
///
/// Kafka commits represent the next record to consume, not the record that was
/// just completed. Negative completed offsets and `i64` overflow are rejected.
pub fn next_offset(completed_record_offset: i64) -> KafkaResult<i64> {
    if completed_record_offset < 0 {
        return Err(invalid_offset_error());
    }

    completed_record_offset
        .checked_add(1)
        .ok_or_else(invalid_offset_error)
}

fn build_partition_offset_list(
    topic: &str,
    partition: i32,
    next_offset: i64,
) -> KafkaResult<TopicPartitionList> {
    CString::new(topic).map_err(KafkaError::Nul)?;
    if topic.is_empty() {
        return Err(KafkaError::Subscription(
            "topic must not be empty".to_string(),
        ));
    }
    if partition < 0 {
        return Err(KafkaError::Subscription(
            "partition must not be negative".to_string(),
        ));
    }

    let mut offsets = TopicPartitionList::with_capacity(1);
    offsets.add_partition_offset(topic, partition, Offset::Offset(next_offset))?;
    Ok(offsets)
}

fn assignment_partitions(assignment: &TopicPartitionList) -> KafkaResult<TopicPartitionList> {
    let mut partitions = TopicPartitionList::with_capacity(assignment.count());
    for element in assignment.elements() {
        element.error()?;
        partitions.add_partition(element.topic(), element.partition());
    }
    Ok(partitions)
}

trait AssignmentControl {
    fn assignment(&self) -> KafkaResult<TopicPartitionList>;
    fn pause(&self, partitions: &TopicPartitionList) -> KafkaResult<()>;
    fn resume(&self, partitions: &TopicPartitionList) -> KafkaResult<()>;
}

impl<C: ConsumerContext> AssignmentControl for StreamConsumer<C> {
    fn assignment(&self) -> KafkaResult<TopicPartitionList> {
        Consumer::assignment(self)
    }

    fn pause(&self, partitions: &TopicPartitionList) -> KafkaResult<()> {
        Consumer::pause(self, partitions)
    }

    fn resume(&self, partitions: &TopicPartitionList) -> KafkaResult<()> {
        Consumer::resume(self, partitions)
    }
}

fn pause_consumer_assignment(consumer: &impl AssignmentControl) -> KafkaResult<()> {
    let assignment = consumer.assignment()?;
    let partitions = assignment_partitions(&assignment)?;
    consumer.pause(&partitions)
}

fn resume_consumer_assignment(consumer: &impl AssignmentControl) -> KafkaResult<()> {
    let assignment = consumer.assignment()?;
    let partitions = assignment_partitions(&assignment)?;
    consumer.resume(&partitions)
}

impl KafkaEventProducer {
    /// Creates a producer, selecting plaintext or MSK IAM transport from the runtime environment.
    ///
    /// Producer creation is lazy: no broker connection or IAM token is created
    /// until a message is sent.
    pub fn from_env(brokers: &str) -> Result<Self, KafkaProducerError> {
        create_producer_from_env(producer_config(brokers))
    }

    /// Sends a keyed payload to `topic` and waits for delivery confirmation.
    #[tracing::instrument(err, skip(self, payload), fields(topic, key))]
    pub async fn send(&self, topic: &str, key: &str, payload: &[u8]) -> KafkaResult<()> {
        let record = FutureRecord::to(topic).key(key).payload(payload);
        either::for_both!(&self.producer.0, producer => producer.send(record, SEND_TIMEOUT).await)
            .map(|_| ())
            .map_err(|(error, _)| error)
    }
}

impl<T> KafkaEventConsumer<T> {
    /// Receives the next Kafka message.
    ///
    /// `StreamConsumer::recv` is cancel-safe and may be used in `tokio::select!`.
    pub async fn recv(&self) -> KafkaResult<BorrowedMessage<'_>> {
        either::for_both!(&self.consumer.0, consumer => consumer.recv().await)
    }

    /// Pauses the partition containing `message`.
    ///
    /// Grouped consumers can use this to prevent a later cumulative commit
    /// from advancing past a failed record. Ungrouped consumers can use it to
    /// stop additional delivery from a failed partition.
    pub fn pause_message_partition(&self, message: &BorrowedMessage<'_>) -> KafkaResult<()> {
        let mut partitions = TopicPartitionList::new();
        partitions.add_partition(message.topic(), message.partition());
        either::for_both!(&self.consumer.0, consumer => Consumer::pause(consumer, &partitions))
    }
}

impl<T: GroupName> KafkaEventConsumer<T> {
    /// Creates a named-group consumer, selecting plaintext or MSK IAM transport
    /// from the runtime environment.
    pub fn from_env(brokers: &str) -> Result<Self, KafkaConsumerError> {
        create_consumer_from_env(grouped_config::<T>(brokers), None)
    }

    /// Creates a cooperative named-group consumer with a custom max poll interval.
    ///
    /// This opt-in constructor installs a [`RebalanceTracker`] and pins
    /// `partition.assignment.strategy=cooperative-sticky`. Existing constructors
    /// retain librdkafka's default eager assignment strategy.
    pub fn from_env_with_max_poll_interval(
        brokers: &str,
        max_poll_interval: Duration,
    ) -> Result<Self, KafkaConsumerError> {
        let config = grouped_config_with_max_poll_interval::<T>(brokers, max_poll_interval)?;
        let rebalance_tracker = RebalanceTracker::new();
        create_consumer_from_env(config, Some(rebalance_tracker))
    }

    /// Returns the opt-in rebalance tracker installed by the cooperative constructor.
    pub fn rebalance_tracker(&self) -> Option<RebalanceTracker> {
        self.rebalance_tracker.clone()
    }

    /// Subscribes the consumer to exactly the provided topics.
    pub fn subscribe(&self, topics: &[&str]) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => consumer.subscribe(topics))
    }

    /// Commits a message using the caller-selected commit mode.
    pub fn commit_message(
        &self,
        message: &BorrowedMessage<'_>,
        mode: CommitMode,
    ) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => consumer.commit_message(message, mode))
    }

    /// Commits a caller-provided next offset for one topic-partition.
    ///
    /// `next_offset` is the next record Kafka should deliver. Use
    /// [`next_offset`] when converting a completed record's offset.
    pub fn commit_partition_offset(
        &self,
        topic: &str,
        partition: i32,
        next_offset: i64,
        mode: CommitMode,
    ) -> KafkaResult<()> {
        let offsets = build_partition_offset_list(topic, partition, next_offset)?;
        either::for_both!(&self.consumer.0, consumer => consumer.commit(&offsets, mode))
    }

    /// Pauses every partition in the consumer's current assignment.
    pub fn pause_current_assignment(&self) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => pause_consumer_assignment(consumer))
    }

    /// Resumes every partition in the consumer's current assignment.
    pub fn resume_current_assignment(&self) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => resume_consumer_assignment(consumer))
    }
}

impl KafkaEventConsumer<Ungrouped> {
    /// Creates an ungrouped consumer, selecting plaintext or MSK IAM transport
    /// from the runtime environment.
    ///
    /// Call [`Self::assign_topics`] before receiving messages.
    pub fn from_env(brokers: &str) -> Result<Self, KafkaConsumerError> {
        create_consumer_from_env(ungrouped_config(brokers), None)
    }

    /// Manually assigns every current partition of `topics` at `initial_offset`.
    ///
    /// Manual assignment does not join a consumer group, persist offsets, or
    /// automatically discover partitions added after this call. Callers that
    /// support partition-count changes must refresh the assignment themselves.
    pub fn assign_topics(
        &self,
        topics: &[&str],
        initial_offset: InitialOffset,
        metadata_timeout: Duration,
    ) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => {
            // OAUTHBEARER requires polling once to install the initial token
            // before a synchronous metadata request can connect to a broker.
            let mut recv = std::pin::pin!(consumer.recv());
            let waker = std::task::Waker::noop();
            let mut context = std::task::Context::from_waker(waker);
            let _ = std::future::Future::poll(recv.as_mut(), &mut context);

            let assignment = build_assignment(
                consumer,
                topics,
                initial_offset,
                metadata_timeout,
            )?;
            consumer.assign(&assignment)
        })
    }
}
