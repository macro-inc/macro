//! Bounded-parallel Kafka delivery with receipt-order commit tracking.
//!
//! The coordinator only manages transport and commit correctness. It does not
//! inspect message keys or payloads, and it deliberately provides no retry,
//! timeout, per-key ordering, or per-partition processing-order guarantees.
//! Callers that require ordering beyond safe contiguous commits should not use
//! this coordinator.

#[cfg(test)]
mod test;

use std::collections::{HashMap, VecDeque};
use std::future::Future;

use rdkafka::consumer::CommitMode;
use rdkafka::error::KafkaError;
use rdkafka::message::{Message as _, OwnedMessage};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::task::{AbortHandle, JoinSet};

use crate::{
    AssignmentEpoch, GroupName, KafkaEventConsumer, PartitionAssignment, RebalanceEvent,
    RebalanceTracker, TopicPartition, next_offset,
};

/// Invalid bounded-parallel consumer configuration.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ParallelConsumerConfigError {
    /// Processing concurrency must be greater than zero.
    #[error("parallel Kafka processing concurrency must be greater than zero")]
    ZeroProcessingConcurrency,
    /// The outstanding-message limit must be greater than zero.
    #[error("parallel Kafka outstanding-message limit must be greater than zero")]
    ZeroMaxOutstanding,
    /// The outstanding-message limit must accommodate every processing slot.
    #[error(
        "parallel Kafka outstanding-message limit {max_outstanding} is smaller than processing concurrency {processing_concurrency}"
    )]
    MaxOutstandingBelowConcurrency {
        /// Configured number of processing slots.
        processing_concurrency: usize,
        /// Configured outstanding-message limit.
        max_outstanding: usize,
    },
    /// The pause-race hard ceiling cannot be represented as a `usize`.
    #[error("parallel Kafka outstanding-message hard ceiling overflows usize")]
    OutstandingHardLimitOverflow,
}

/// Validated limits for a bounded-parallel Kafka consumer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParallelConsumerConfig {
    processing_concurrency: usize,
    max_outstanding: usize,
    outstanding_hard_limit: usize,
}

impl ParallelConsumerConfig {
    /// Validates and creates parallel-consumer limits.
    ///
    /// `max_outstanding` counts every received record that has not been released
    /// by a successful contiguous commit, including queued, active, and completed
    /// records. It must be at least `processing_concurrency`.
    pub fn new(
        processing_concurrency: usize,
        max_outstanding: usize,
    ) -> Result<Self, ParallelConsumerConfigError> {
        if processing_concurrency == 0 {
            return Err(ParallelConsumerConfigError::ZeroProcessingConcurrency);
        }
        if max_outstanding == 0 {
            return Err(ParallelConsumerConfigError::ZeroMaxOutstanding);
        }
        if max_outstanding < processing_concurrency {
            return Err(
                ParallelConsumerConfigError::MaxOutstandingBelowConcurrency {
                    processing_concurrency,
                    max_outstanding,
                },
            );
        }
        let outstanding_hard_limit = max_outstanding
            .checked_add(processing_concurrency)
            .ok_or(ParallelConsumerConfigError::OutstandingHardLimitOverflow)?;

        Ok(Self {
            processing_concurrency,
            max_outstanding,
            outstanding_hard_limit,
        })
    }

    /// Returns the maximum number of processing futures run at once.
    pub fn processing_concurrency(self) -> usize {
        self.processing_concurrency
    }

    /// Returns the soft limit for received but not contiguously committed records.
    pub fn max_outstanding(self) -> usize {
        self.max_outstanding
    }
}

/// Fatal termination from the bounded-parallel coordinator.
#[derive(Debug, thiserror::Error)]
pub enum ParallelConsumerError<ProcessError> {
    /// The consumer was not built by the cooperative max-poll constructor.
    #[error("parallel Kafka consumption requires a cooperative rebalance tracker")]
    RebalanceTrackerUnavailable,
    /// Another coordinator already took this consumer's rebalance stream.
    #[error("the Kafka rebalance event stream is already in use")]
    RebalanceEventsAlreadyTaken,
    /// The rebalance notification stream ended unexpectedly.
    #[error("the Kafka rebalance event stream ended unexpectedly")]
    RebalanceEventStreamClosed,
    /// librdkafka reported a rebalance callback failure.
    #[error("Kafka rebalance failed: {0}")]
    Rebalance(String),
    /// Receiving the next record failed.
    #[error("failed to receive a Kafka record")]
    Receive(#[source] KafkaError),
    /// Pausing the current assignment failed.
    #[error("failed to pause the Kafka consumer assignment")]
    Pause(#[source] KafkaError),
    /// Resuming the current assignment failed.
    #[error("failed to resume the Kafka consumer assignment")]
    Resume(#[source] KafkaError),
    /// Submitting a contiguous next-offset commit failed.
    #[error("failed to commit a contiguous Kafka offset")]
    Commit(#[source] KafkaError),
    /// A received record offset could not be converted to Kafka's next-offset convention.
    #[error("received a Kafka record with an invalid offset")]
    InvalidOffset(#[source] KafkaError),
    /// Deliveries continued beyond the bounded pause-race allowance.
    #[error(
        "Kafka deliveries exceeded the pause-race hard ceiling: outstanding {outstanding}, hard limit {hard_limit}"
    )]
    OutstandingHardLimitExceeded {
        /// Outstanding count that would have resulted from accepting the delivery.
        outstanding: usize,
        /// Maximum accepted count, including the pause-race allowance.
        hard_limit: usize,
    },
    /// A processing future reported a fatal, non-commit-safe result.
    #[error("parallel Kafka message processing reported a fatal failure")]
    Processing(ProcessError),
    /// A spawned processing future panicked or was unexpectedly cancelled.
    #[error("parallel Kafka processing task failed: {0}")]
    ProcessingTask(String),
    /// Internal capacity or receipt bookkeeping violated a coordinator invariant.
    #[error("parallel Kafka coordinator invariant failed: {0}")]
    CoordinatorInvariant(&'static str),
}

/// Runs a cooperative Kafka consumer with bounded parallel processing.
///
/// The consumer must have been created with
/// [`KafkaEventConsumer::from_env_with_max_poll_interval`]. The `process`
/// function receives a detached [`OwnedMessage`]. Returning `Ok(())` declares
/// the record commit-safe, whether it was handled, intentionally ignored, or
/// dropped by a caller-owned delivery policy. Returning `Err` is fatal and
/// stops the coordinator without committing that record or any unfinished
/// record behind it.
///
/// Commits use receipt order independently for each topic-partition and never
/// assume Kafka offsets are numerically consecutive.
pub async fn run_parallel_consumer<T, Process, ProcessFuture, ProcessError>(
    consumer: KafkaEventConsumer<T>,
    config: ParallelConsumerConfig,
    commit_mode: CommitMode,
    process: Process,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    T: GroupName,
    Process: Fn(OwnedMessage) -> ProcessFuture,
    ProcessFuture: Future<Output = Result<(), ProcessError>> + Send + 'static,
    ProcessError: Send + 'static,
{
    let tracker = consumer
        .rebalance_tracker()
        .ok_or(ParallelConsumerError::RebalanceTrackerUnavailable)?;
    let rebalance_events = tracker
        .take_events()
        .ok_or(ParallelConsumerError::RebalanceEventsAlreadyTaken)?;
    let transport = KafkaParallelTransport { consumer, tracker };

    run_coordinator(transport, rebalance_events, config, commit_mode, process).await
}

struct ReceivedMessage<Message> {
    message: Message,
    topic_partition: TopicPartition,
    offset: i64,
    epoch: Option<AssignmentEpoch>,
}

enum CommitSubmission {
    Submitted,
    Fenced,
}

trait ParallelTransport {
    type Message;

    async fn receive(&self) -> Result<ReceivedMessage<Self::Message>, KafkaError>;
    fn commit(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
        next_offset: i64,
        mode: CommitMode,
    ) -> Result<CommitSubmission, KafkaError>;
    fn pause_current_assignment(&self) -> Result<(), KafkaError>;
    fn resume_current_assignment(&self) -> Result<(), KafkaError>;
    fn current_assignments(&self) -> Vec<PartitionAssignment>;
    fn is_current_assignment(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
    ) -> bool;
}

struct KafkaParallelTransport<T> {
    consumer: KafkaEventConsumer<T>,
    tracker: RebalanceTracker,
}

impl<T: GroupName> ParallelTransport for KafkaParallelTransport<T> {
    type Message = OwnedMessage;

    async fn receive(&self) -> Result<ReceivedMessage<Self::Message>, KafkaError> {
        let message = self.consumer.recv().await?;
        let topic_partition = TopicPartition {
            topic: message.topic().to_string(),
            partition: message.partition(),
        };
        let offset = message.offset();
        let epoch = self
            .tracker
            .assignment_epoch(&topic_partition.topic, topic_partition.partition);

        Ok(ReceivedMessage {
            message: message.detach(),
            topic_partition,
            offset,
            epoch,
        })
    }

    fn commit(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
        next_offset: i64,
        mode: CommitMode,
    ) -> Result<CommitSubmission, KafkaError> {
        let submission = self
            .tracker
            .with_current_assignment(topic_partition, epoch, || {
                self.consumer.commit_partition_offset(
                    &topic_partition.topic,
                    topic_partition.partition,
                    next_offset,
                    mode,
                )
            });

        match submission {
            Some(result) => {
                result?;
                Ok(CommitSubmission::Submitted)
            }
            None => Ok(CommitSubmission::Fenced),
        }
    }

    fn pause_current_assignment(&self) -> Result<(), KafkaError> {
        self.consumer.pause_current_assignment()
    }

    fn resume_current_assignment(&self) -> Result<(), KafkaError> {
        self.consumer.resume_current_assignment()
    }

    fn current_assignments(&self) -> Vec<PartitionAssignment> {
        self.tracker.current_assignments()
    }

    fn is_current_assignment(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
    ) -> bool {
        self.tracker
            .is_current_assignment(&topic_partition.topic, topic_partition.partition, epoch)
    }
}

struct PendingWork<Message> {
    receipt_id: u64,
    message: Message,
    topic_partition: TopicPartition,
    epoch: AssignmentEpoch,
}

struct TrackedReceipt {
    receipt_id: u64,
    offset: i64,
    completed: bool,
}

struct PartitionState {
    epoch: AssignmentEpoch,
    receipts: VecDeque<TrackedReceipt>,
}

struct ActiveWork {
    topic_partition: TopicPartition,
    epoch: AssignmentEpoch,
    abort_handle: AbortHandle,
}

struct ActiveCompletion<ProcessError> {
    receipt_id: u64,
    topic_partition: TopicPartition,
    epoch: AssignmentEpoch,
    result: Result<(), ProcessError>,
}

struct CoordinatorState<Message> {
    partitions: HashMap<TopicPartition, PartitionState>,
    pending: VecDeque<PendingWork<Message>>,
    active: HashMap<u64, ActiveWork>,
    next_receipt_id: u64,
    paused: bool,
}

impl<Message> CoordinatorState<Message> {
    fn new(assignments: Vec<PartitionAssignment>) -> Self {
        let partitions = assignments
            .into_iter()
            .map(|assignment| {
                (
                    assignment.topic_partition,
                    PartitionState {
                        epoch: assignment.epoch,
                        receipts: VecDeque::new(),
                    },
                )
            })
            .collect();

        Self {
            partitions,
            pending: VecDeque::new(),
            active: HashMap::new(),
            next_receipt_id: 0,
            paused: false,
        }
    }

    fn outstanding(&self) -> usize {
        self.partitions
            .values()
            .map(|partition| partition.receipts.len())
            .sum()
    }

    fn register(
        &mut self,
        message: Message,
        topic_partition: TopicPartition,
        epoch: AssignmentEpoch,
        offset: i64,
    ) -> Result<(), &'static str> {
        let receipt_id = self.next_receipt_id;
        self.next_receipt_id = self
            .next_receipt_id
            .checked_add(1)
            .ok_or("receipt identifier exhausted")?;
        self.partitions
            .get_mut(&topic_partition)
            .ok_or("current partition state missing during receipt registration")?
            .receipts
            .push_back(TrackedReceipt {
                receipt_id,
                offset,
                completed: false,
            });
        self.pending.push_back(PendingWork {
            receipt_id,
            message,
            topic_partition,
            epoch,
        });
        Ok(())
    }

    fn fence_partition(&mut self, topic_partition: &TopicPartition) {
        self.partitions.remove(topic_partition);
        self.pending
            .retain(|work| work.topic_partition != *topic_partition);

        let revoked_receipts = self
            .active
            .iter()
            .filter_map(|(receipt_id, work)| {
                (work.topic_partition == *topic_partition).then_some(*receipt_id)
            })
            .collect::<Vec<_>>();
        for receipt_id in revoked_receipts {
            if let Some(work) = self.active.remove(&receipt_id) {
                work.abort_handle.abort();
            }
        }
    }

    fn apply_assignment(&mut self, assignment: PartitionAssignment) {
        let topic_partition = assignment.topic_partition;
        if self
            .partitions
            .get(&topic_partition)
            .is_some_and(|state| state.epoch == assignment.epoch)
        {
            return;
        }

        self.fence_partition(&topic_partition);
        self.partitions.insert(
            topic_partition,
            PartitionState {
                epoch: assignment.epoch,
                receipts: VecDeque::new(),
            },
        );
    }
}

async fn run_coordinator<Transport, Process, ProcessFuture, ProcessError>(
    transport: Transport,
    mut rebalance_events: UnboundedReceiver<RebalanceEvent>,
    config: ParallelConsumerConfig,
    commit_mode: CommitMode,
    process: Process,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    Transport: ParallelTransport,
    Transport::Message: Send + 'static,
    Process: Fn(Transport::Message) -> ProcessFuture,
    ProcessFuture: Future<Output = Result<(), ProcessError>> + Send + 'static,
    ProcessError: Send + 'static,
{
    let mut state = CoordinatorState::new(transport.current_assignments());
    let mut processing_tasks = JoinSet::new();

    loop {
        fence_stale_partitions(&transport, &mut state);
        fill_processing_slots(
            &mut state,
            &mut processing_tasks,
            config.processing_concurrency,
            &process,
        );
        reconcile_backpressure(&transport, &mut state, config)?;
        assert_state_invariants(&state, config);

        tokio::select! {
            biased;
            rebalance = rebalance_events.recv() => {
                let rebalance = rebalance
                    .ok_or(ParallelConsumerError::RebalanceEventStreamClosed)?;
                handle_rebalance(&transport, &mut state, rebalance)?;
            }
            completion = processing_tasks.join_next(), if !processing_tasks.is_empty() => {
                let completion = completion.expect("a non-empty processing task set must yield a task");
                match completion {
                    Ok(completion) => {
                        handle_completion(
                            &transport,
                            &mut state,
                            completion,
                            commit_mode,
                        )?;
                    }
                    Err(error) if error.is_cancelled() => {}
                    Err(error) => {
                        return Err(ParallelConsumerError::ProcessingTask(error.to_string()));
                    }
                }
            }
            delivery = transport.receive() => {
                let delivery = delivery.map_err(ParallelConsumerError::Receive)?;
                handle_delivery(&transport, &mut state, delivery, config)?;
            }
        }
    }
}

fn fill_processing_slots<Message, Process, ProcessFuture, ProcessError>(
    state: &mut CoordinatorState<Message>,
    processing_tasks: &mut JoinSet<ActiveCompletion<ProcessError>>,
    processing_concurrency: usize,
    process: &Process,
) where
    Message: Send + 'static,
    Process: Fn(Message) -> ProcessFuture,
    ProcessFuture: Future<Output = Result<(), ProcessError>> + Send + 'static,
    ProcessError: Send + 'static,
{
    while state.active.len() < processing_concurrency {
        let Some(work) = state.pending.pop_front() else {
            break;
        };

        let receipt_id = work.receipt_id;
        let topic_partition = work.topic_partition;
        let epoch = work.epoch;
        let process_future = process(work.message);
        let completion_topic_partition = topic_partition.clone();
        let abort_handle = processing_tasks.spawn(async move {
            ActiveCompletion {
                receipt_id,
                topic_partition: completion_topic_partition,
                epoch,
                result: process_future.await,
            }
        });
        state.active.insert(
            receipt_id,
            ActiveWork {
                topic_partition,
                epoch,
                abort_handle,
            },
        );
    }
}

fn fence_stale_partitions<Transport: ParallelTransport>(
    transport: &Transport,
    state: &mut CoordinatorState<Transport::Message>,
) {
    let stale_partitions = state
        .partitions
        .iter()
        .filter_map(|(topic_partition, partition)| {
            (!transport.is_current_assignment(topic_partition, partition.epoch))
                .then_some(topic_partition.clone())
        })
        .collect::<Vec<_>>();

    for topic_partition in stale_partitions {
        state.fence_partition(&topic_partition);
    }
}

fn reconcile_backpressure<Transport, ProcessError>(
    transport: &Transport,
    state: &mut CoordinatorState<Transport::Message>,
    config: ParallelConsumerConfig,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    Transport: ParallelTransport,
{
    let outstanding = state.outstanding();
    if !state.paused && outstanding >= config.max_outstanding {
        transport
            .pause_current_assignment()
            .map_err(ParallelConsumerError::Pause)?;
        state.paused = true;
    } else if state.paused && outstanding < config.max_outstanding {
        transport
            .resume_current_assignment()
            .map_err(ParallelConsumerError::Resume)?;
        state.paused = false;
    }

    Ok(())
}

fn handle_rebalance<Transport, ProcessError>(
    transport: &Transport,
    state: &mut CoordinatorState<Transport::Message>,
    event: RebalanceEvent,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    Transport: ParallelTransport,
{
    match event {
        RebalanceEvent::Assigned(assignments) => {
            let had_assignments = !assignments.is_empty();
            for assignment in assignments {
                state.apply_assignment(assignment);
            }
            if state.paused && had_assignments {
                transport
                    .pause_current_assignment()
                    .map_err(ParallelConsumerError::Pause)?;
            }
        }
        RebalanceEvent::Revoked(assignments) => {
            for assignment in assignments {
                let should_fence = state
                    .partitions
                    .get(&assignment.topic_partition)
                    .is_some_and(|partition| partition.epoch < assignment.epoch);
                if should_fence {
                    state.fence_partition(&assignment.topic_partition);
                }
            }
        }
        RebalanceEvent::Error(error) => return Err(ParallelConsumerError::Rebalance(error)),
    }

    Ok(())
}

fn handle_delivery<Transport, ProcessError>(
    transport: &Transport,
    state: &mut CoordinatorState<Transport::Message>,
    delivery: ReceivedMessage<Transport::Message>,
    config: ParallelConsumerConfig,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    Transport: ParallelTransport,
{
    next_offset(delivery.offset).map_err(ParallelConsumerError::InvalidOffset)?;

    let Some(epoch) = delivery.epoch else {
        tracing::warn!(
            topic = delivery.topic_partition.topic,
            partition = delivery.topic_partition.partition,
            offset = delivery.offset,
            "discarding Kafka delivery without a current assignment"
        );
        return Ok(());
    };
    if !transport.is_current_assignment(&delivery.topic_partition, epoch) {
        tracing::warn!(
            topic = delivery.topic_partition.topic,
            partition = delivery.topic_partition.partition,
            offset = delivery.offset,
            epoch = epoch.value(),
            "discarding Kafka delivery from a fenced assignment epoch"
        );
        return Ok(());
    }

    let next_outstanding =
        state
            .outstanding()
            .checked_add(1)
            .ok_or(ParallelConsumerError::CoordinatorInvariant(
                "outstanding-message count exhausted",
            ))?;
    if next_outstanding > config.outstanding_hard_limit {
        return Err(ParallelConsumerError::OutstandingHardLimitExceeded {
            outstanding: next_outstanding,
            hard_limit: config.outstanding_hard_limit,
        });
    }
    if next_outstanding > config.max_outstanding {
        tracing::warn!(
            outstanding = next_outstanding,
            max_outstanding = config.max_outstanding,
            processing_concurrency = config.processing_concurrency,
            topic = delivery.topic_partition.topic,
            partition = delivery.topic_partition.partition,
            offset = delivery.offset,
            "accepting Kafka delivery that raced assignment pause"
        );
    }

    let replace_partition = state
        .partitions
        .get(&delivery.topic_partition)
        .is_some_and(|partition| partition.epoch != epoch);
    if replace_partition {
        state.fence_partition(&delivery.topic_partition);
    }
    state
        .partitions
        .entry(delivery.topic_partition.clone())
        .or_insert_with(|| PartitionState {
            epoch,
            receipts: VecDeque::new(),
        });
    state
        .register(
            delivery.message,
            delivery.topic_partition,
            epoch,
            delivery.offset,
        )
        .map_err(ParallelConsumerError::CoordinatorInvariant)
}

fn handle_completion<Transport, ProcessError>(
    transport: &Transport,
    state: &mut CoordinatorState<Transport::Message>,
    completion: ActiveCompletion<ProcessError>,
    commit_mode: CommitMode,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    Transport: ParallelTransport,
{
    let Some(active) = state.active.remove(&completion.receipt_id) else {
        return Ok(());
    };
    if active.topic_partition != completion.topic_partition || active.epoch != completion.epoch {
        return Ok(());
    }
    if !transport.is_current_assignment(&completion.topic_partition, completion.epoch) {
        return Ok(());
    }
    let Some(partition) = state.partitions.get_mut(&completion.topic_partition) else {
        return Ok(());
    };
    if partition.epoch != completion.epoch {
        return Ok(());
    }

    completion
        .result
        .map_err(ParallelConsumerError::Processing)?;
    let Some(receipt) = partition
        .receipts
        .iter_mut()
        .find(|receipt| receipt.receipt_id == completion.receipt_id)
    else {
        return Ok(());
    };
    receipt.completed = true;

    commit_completed_prefix(transport, state, &completion.topic_partition, commit_mode)
}

fn commit_completed_prefix<Transport, ProcessError>(
    transport: &Transport,
    state: &mut CoordinatorState<Transport::Message>,
    topic_partition: &TopicPartition,
    commit_mode: CommitMode,
) -> Result<(), ParallelConsumerError<ProcessError>>
where
    Transport: ParallelTransport,
{
    let Some(partition) = state.partitions.get(topic_partition) else {
        return Ok(());
    };
    if !transport.is_current_assignment(topic_partition, partition.epoch) {
        return Ok(());
    }

    let completed_count = partition
        .receipts
        .iter()
        .take_while(|receipt| receipt.completed)
        .count();
    if completed_count == 0 {
        return Ok(());
    }
    let completed_offset = partition.receipts[completed_count - 1].offset;
    let commit_offset =
        next_offset(completed_offset).map_err(ParallelConsumerError::InvalidOffset)?;
    let submission = transport
        .commit(topic_partition, partition.epoch, commit_offset, commit_mode)
        .map_err(ParallelConsumerError::Commit)?;
    if matches!(submission, CommitSubmission::Fenced) {
        return Ok(());
    }

    let partition = state
        .partitions
        .get_mut(topic_partition)
        .expect("partition ownership was checked before synchronous commit");
    partition.receipts.drain(..completed_count);
    Ok(())
}

fn assert_state_invariants<Message>(
    state: &CoordinatorState<Message>,
    config: ParallelConsumerConfig,
) {
    debug_assert!(state.active.len() <= config.processing_concurrency);
    debug_assert!(state.outstanding() <= config.outstanding_hard_limit);
    debug_assert!(state.pending.iter().all(|work| {
        state
            .partitions
            .get(&work.topic_partition)
            .is_some_and(|partition| partition.epoch == work.epoch)
    }));
    debug_assert!(state.active.values().all(|work| {
        state
            .partitions
            .get(&work.topic_partition)
            .is_some_and(|partition| partition.epoch == work.epoch)
    }));
}
