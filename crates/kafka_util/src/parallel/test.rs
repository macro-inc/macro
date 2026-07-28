use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rdkafka::error::KafkaError;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use super::*;

const TOPIC: &str = "events";
const POLL_HEARTBEAT: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug)]
struct TestMessage {
    id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Commit {
    topic_partition: TopicPartition,
    next_offset: i64,
}

#[derive(Default)]
struct FakeAssignments {
    generations: HashMap<TopicPartition, AssignmentEpoch>,
    current: HashMap<TopicPartition, AssignmentEpoch>,
}

struct FakeInner {
    assignments: Mutex<FakeAssignments>,
    delivery_sender: mpsc::UnboundedSender<Result<ReceivedMessage<TestMessage>, KafkaError>>,
    rebalance_sender: mpsc::UnboundedSender<RebalanceEvent>,
    commits: Mutex<Vec<Commit>>,
    pause_calls: AtomicUsize,
    resume_calls: AtomicUsize,
    receive_polls: AtomicUsize,
    fail_pause: AtomicBool,
    fail_resume: AtomicBool,
    fail_commit: AtomicBool,
}

struct FakeTransport {
    inner: Arc<FakeInner>,
    delivery_receiver: tokio::sync::Mutex<
        mpsc::UnboundedReceiver<Result<ReceivedMessage<TestMessage>, KafkaError>>,
    >,
}

#[derive(Clone)]
struct FakeControl {
    inner: Arc<FakeInner>,
}

impl FakeTransport {
    fn new() -> (Self, FakeControl, mpsc::UnboundedReceiver<RebalanceEvent>) {
        let (delivery_sender, delivery_receiver) = mpsc::unbounded_channel();
        let (rebalance_sender, rebalance_receiver) = mpsc::unbounded_channel();
        let inner = Arc::new(FakeInner {
            assignments: Mutex::new(FakeAssignments::default()),
            delivery_sender,
            rebalance_sender,
            commits: Mutex::new(Vec::new()),
            pause_calls: AtomicUsize::new(0),
            resume_calls: AtomicUsize::new(0),
            receive_polls: AtomicUsize::new(0),
            fail_pause: AtomicBool::new(false),
            fail_resume: AtomicBool::new(false),
            fail_commit: AtomicBool::new(false),
        });

        (
            Self {
                inner: inner.clone(),
                delivery_receiver: tokio::sync::Mutex::new(delivery_receiver),
            },
            FakeControl { inner },
            rebalance_receiver,
        )
    }
}

impl ParallelTransport for FakeTransport {
    type Message = TestMessage;

    async fn receive(&self) -> Result<ReceivedMessage<Self::Message>, KafkaError> {
        let mut deliveries = self.delivery_receiver.lock().await;
        loop {
            self.inner.receive_polls.fetch_add(1, Ordering::SeqCst);
            tokio::select! {
                delivery = deliveries.recv() => {
                    return delivery.unwrap_or_else(|| {
                        Err(KafkaError::Subscription("fake delivery stream closed".to_string()))
                    });
                }
                () = tokio::time::sleep(POLL_HEARTBEAT) => {}
            }
        }
    }

    fn commit(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
        next_offset: i64,
        _mode: CommitMode,
    ) -> Result<CommitSubmission, KafkaError> {
        let assignments = self.inner.assignments.lock().unwrap();
        if assignments
            .current
            .get(topic_partition)
            .is_none_or(|current_epoch| *current_epoch != epoch)
        {
            return Ok(CommitSubmission::Fenced);
        }
        if self.inner.fail_commit.load(Ordering::SeqCst) {
            return Err(KafkaError::Subscription("fake commit failure".to_string()));
        }
        self.inner.commits.lock().unwrap().push(Commit {
            topic_partition: topic_partition.clone(),
            next_offset,
        });
        Ok(CommitSubmission::Submitted)
    }

    fn pause_current_assignment(&self) -> Result<(), KafkaError> {
        self.inner.pause_calls.fetch_add(1, Ordering::SeqCst);
        if self.inner.fail_pause.load(Ordering::SeqCst) {
            return Err(KafkaError::PauseResume("fake pause failure".to_string()));
        }
        Ok(())
    }

    fn resume_current_assignment(&self) -> Result<(), KafkaError> {
        self.inner.resume_calls.fetch_add(1, Ordering::SeqCst);
        if self.inner.fail_resume.load(Ordering::SeqCst) {
            return Err(KafkaError::PauseResume("fake resume failure".to_string()));
        }
        Ok(())
    }

    fn current_assignments(&self) -> Vec<PartitionAssignment> {
        self.inner
            .assignments
            .lock()
            .unwrap()
            .current
            .iter()
            .map(|(topic_partition, epoch)| PartitionAssignment {
                topic_partition: topic_partition.clone(),
                epoch: *epoch,
            })
            .collect()
    }

    fn is_current_assignment(
        &self,
        topic_partition: &TopicPartition,
        epoch: AssignmentEpoch,
    ) -> bool {
        self.inner
            .assignments
            .lock()
            .unwrap()
            .current
            .get(topic_partition)
            .is_some_and(|current_epoch| *current_epoch == epoch)
    }
}

impl FakeControl {
    fn assign(&self, topic: &str, partition: i32) -> AssignmentEpoch {
        let topic_partition = topic_partition(topic, partition);
        let epoch = {
            let mut assignments = self.inner.assignments.lock().unwrap();
            let next_epoch = assignments
                .generations
                .get(&topic_partition)
                .map_or(1, |epoch| epoch.value() + 1);
            let epoch = AssignmentEpoch(next_epoch);
            assignments
                .generations
                .insert(topic_partition.clone(), epoch);
            assignments.current.insert(topic_partition.clone(), epoch);
            epoch
        };
        self.inner
            .rebalance_sender
            .send(RebalanceEvent::Assigned(vec![PartitionAssignment {
                topic_partition,
                epoch,
            }]))
            .unwrap();
        epoch
    }

    fn revoke(&self, topic: &str, partition: i32) -> AssignmentEpoch {
        let topic_partition = topic_partition(topic, partition);
        let epoch = {
            let mut assignments = self.inner.assignments.lock().unwrap();
            let next_epoch = assignments
                .generations
                .get(&topic_partition)
                .map_or(1, |epoch| epoch.value() + 1);
            let epoch = AssignmentEpoch(next_epoch);
            assignments
                .generations
                .insert(topic_partition.clone(), epoch);
            assignments.current.remove(&topic_partition);
            epoch
        };
        self.inner
            .rebalance_sender
            .send(RebalanceEvent::Revoked(vec![PartitionAssignment {
                topic_partition,
                epoch,
            }]))
            .unwrap();
        epoch
    }

    fn send(&self, id: u64, topic: &str, partition: i32, offset: i64) {
        let topic_partition = topic_partition(topic, partition);
        let epoch = self
            .inner
            .assignments
            .lock()
            .unwrap()
            .current
            .get(&topic_partition)
            .copied();
        self.send_with_epoch(id, topic_partition, offset, epoch);
    }

    fn send_with_epoch(
        &self,
        id: u64,
        topic_partition: TopicPartition,
        offset: i64,
        epoch: Option<AssignmentEpoch>,
    ) {
        self.inner
            .delivery_sender
            .send(Ok(ReceivedMessage {
                message: TestMessage { id },
                topic_partition,
                offset,
                epoch,
            }))
            .unwrap();
    }

    fn fail_receive(&self) {
        self.inner
            .delivery_sender
            .send(Err(KafkaError::Subscription(
                "fake receive failure".to_string(),
            )))
            .unwrap();
    }

    fn commits(&self) -> Vec<Commit> {
        self.inner.commits.lock().unwrap().clone()
    }

    fn pause_calls(&self) -> usize {
        self.inner.pause_calls.load(Ordering::SeqCst)
    }

    fn resume_calls(&self) -> usize {
        self.inner.resume_calls.load(Ordering::SeqCst)
    }

    fn receive_polls(&self) -> usize {
        self.inner.receive_polls.load(Ordering::SeqCst)
    }

    fn fail_pause(&self) {
        self.inner.fail_pause.store(true, Ordering::SeqCst);
    }

    fn fail_resume(&self) {
        self.inner.fail_resume.store(true, Ordering::SeqCst);
    }

    fn fail_commit(&self) {
        self.inner.fail_commit.store(true, Ordering::SeqCst);
    }

    fn epoch(&self, topic: &str, partition: i32) -> Option<AssignmentEpoch> {
        self.inner
            .assignments
            .lock()
            .unwrap()
            .current
            .get(&topic_partition(topic, partition))
            .copied()
    }
}

#[derive(Debug, thiserror::Error)]
enum TestProcessError {
    #[error("test requested a fatal processing outcome")]
    Fatal,
    #[error("test process control channel closed")]
    ControlClosed,
}

struct StartedWork {
    id: u64,
    completion: oneshot::Sender<Result<(), TestProcessError>>,
}

impl StartedWork {
    fn commit_safe(self) {
        self.completion.send(Ok(())).unwrap();
    }

    fn fatal(self) {
        self.completion.send(Err(TestProcessError::Fatal)).unwrap();
    }
}

type TestResult = Result<(), ParallelConsumerError<TestProcessError>>;

#[derive(Default)]
struct ProcessMetrics {
    executing: AtomicUsize,
    maximum_executing: AtomicUsize,
}

struct ExecutionGuard {
    metrics: Arc<ProcessMetrics>,
}

impl ExecutionGuard {
    fn new(metrics: Arc<ProcessMetrics>) -> Self {
        let executing = metrics.executing.fetch_add(1, Ordering::SeqCst) + 1;
        metrics
            .maximum_executing
            .fetch_max(executing, Ordering::SeqCst);
        Self { metrics }
    }
}

impl Drop for ExecutionGuard {
    fn drop(&mut self) {
        self.metrics.executing.fetch_sub(1, Ordering::SeqCst);
    }
}

struct Harness {
    control: FakeControl,
    started: mpsc::UnboundedReceiver<StartedWork>,
    coordinator: JoinHandle<TestResult>,
    process_metrics: Arc<ProcessMetrics>,
}

impl Harness {
    fn start(config: ParallelConsumerConfig, partitions: &[i32]) -> Self {
        let (transport, control, rebalance_events) = FakeTransport::new();
        for partition in partitions {
            control.assign(TOPIC, *partition);
        }
        let (started_sender, started) = mpsc::unbounded_channel();
        let process_metrics = Arc::new(ProcessMetrics::default());
        let process_metrics_for_work = process_metrics.clone();
        let process = move |message: TestMessage| {
            let (completion, completed) = oneshot::channel();
            let sent = started_sender.send(StartedWork {
                id: message.id,
                completion,
            });
            let process_metrics = process_metrics_for_work.clone();
            async move {
                let _execution = ExecutionGuard::new(process_metrics);
                if sent.is_err() {
                    return Err(TestProcessError::ControlClosed);
                }
                completed
                    .await
                    .unwrap_or(Err(TestProcessError::ControlClosed))
            }
        };
        let coordinator = tokio::spawn(run_coordinator(
            transport,
            rebalance_events,
            config,
            CommitMode::Async,
            process,
        ));

        Self {
            control,
            started,
            coordinator,
            process_metrics,
        }
    }

    async fn next_started(&mut self) -> StartedWork {
        self.started.recv().await.expect("expected work to start")
    }

    fn assert_no_work_started(&mut self) {
        assert!(matches!(
            self.started.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }

    fn executing(&self) -> usize {
        self.process_metrics.executing.load(Ordering::SeqCst)
    }

    fn maximum_executing(&self) -> usize {
        self.process_metrics
            .maximum_executing
            .load(Ordering::SeqCst)
    }

    async fn stop(self) -> ParallelConsumerError<TestProcessError> {
        self.control.fail_receive();
        self.coordinator
            .await
            .expect("coordinator task should not panic")
            .expect_err("fake receive failure should stop coordinator")
    }
}

fn topic_partition(topic: &str, partition: i32) -> TopicPartition {
    TopicPartition {
        topic: topic.to_string(),
        partition,
    }
}

async fn settle() {
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
}

async fn wait_until(mut condition: impl FnMut() -> bool) {
    for _ in 0..100 {
        if condition() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("condition did not become true");
}

#[test]
fn configuration_rejects_zero_undersized_and_overflowing_limits() {
    assert_eq!(
        ParallelConsumerConfig::new(0, 1),
        Err(ParallelConsumerConfigError::ZeroProcessingConcurrency)
    );
    assert_eq!(
        ParallelConsumerConfig::new(1, 0),
        Err(ParallelConsumerConfigError::ZeroMaxOutstanding)
    );
    assert_eq!(
        ParallelConsumerConfig::new(3, 2),
        Err(
            ParallelConsumerConfigError::MaxOutstandingBelowConcurrency {
                processing_concurrency: 3,
                max_outstanding: 2,
            }
        )
    );
    assert_eq!(
        ParallelConsumerConfig::new(1, usize::MAX),
        Err(ParallelConsumerConfigError::OutstandingHardLimitOverflow)
    );

    let config = ParallelConsumerConfig::new(3, 8).unwrap();
    assert_eq!(config.processing_concurrency(), 3);
    assert_eq!(config.max_outstanding(), 8);
}

#[tokio::test]
async fn concurrency_is_capped_and_two_completions_refill_two_slots_fifo() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(3, 6).unwrap(), &[0]);
    for id in 0..6 {
        harness.control.send(id, TOPIC, 0, 10 + id as i64 * 10);
    }

    let first = harness.next_started().await;
    let second = harness.next_started().await;
    let third = harness.next_started().await;
    assert_eq!([first.id, second.id, third.id], [0, 1, 2]);
    harness.assert_no_work_started();
    wait_until(|| harness.executing() == 3).await;
    assert_eq!(harness.maximum_executing(), 3);

    second.commit_safe();
    third.commit_safe();
    let fourth = harness.next_started().await;
    let fifth = harness.next_started().await;
    assert_eq!([fourth.id, fifth.id], [3, 4]);
    harness.assert_no_work_started();
    wait_until(|| harness.executing() == 3).await;
    assert_eq!(harness.maximum_executing(), 3);
    assert!(harness.control.commits().is_empty());

    first.commit_safe();
    wait_until(|| !harness.control.commits().is_empty()).await;
    assert_eq!(harness.control.commits()[0].next_offset, 31);

    assert!(matches!(
        harness.stop().await,
        ParallelConsumerError::Receive(_)
    ));
}

#[tokio::test]
async fn out_of_order_completion_commits_receipt_order_across_offset_gaps() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(3, 4).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 4);
    harness.control.send(1, TOPIC, 0, 9);
    harness.control.send(2, TOPIC, 0, 15);
    let first = harness.next_started().await;
    let second = harness.next_started().await;
    let third = harness.next_started().await;

    third.commit_safe();
    second.commit_safe();
    settle().await;
    assert!(harness.control.commits().is_empty());

    first.commit_safe();
    wait_until(|| harness.control.commits().len() == 1).await;
    assert_eq!(harness.control.commits()[0].next_offset, 16);

    harness.stop().await;
}

#[tokio::test]
async fn partitions_commit_independently() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 4).unwrap(), &[0, 1]);
    harness.control.send(0, TOPIC, 0, 100);
    harness.control.send(1, TOPIC, 1, 7);
    let partition_zero = harness.next_started().await;
    let partition_one = harness.next_started().await;

    partition_one.commit_safe();
    wait_until(|| harness.control.commits().len() == 1).await;
    assert_eq!(
        harness.control.commits()[0],
        Commit {
            topic_partition: topic_partition(TOPIC, 1),
            next_offset: 8,
        }
    );

    partition_zero.commit_safe();
    wait_until(|| harness.control.commits().len() == 2).await;
    assert_eq!(harness.control.commits()[1].topic_partition.partition, 0);
    harness.stop().await;
}

#[tokio::test]
async fn commit_safe_drop_unblocks_a_completed_prefix() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 3).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 20);
    harness.control.send(1, TOPIC, 0, 25);
    let delayed = harness.next_started().await;
    let policy_drop = harness.next_started().await;

    policy_drop.commit_safe();
    settle().await;
    assert!(harness.control.commits().is_empty());
    delayed.commit_safe();
    wait_until(|| harness.control.commits().len() == 1).await;
    assert_eq!(harness.control.commits()[0].next_offset, 26);

    harness.stop().await;
}

#[tokio::test]
async fn fatal_processing_stops_without_committing_the_failed_prefix() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 3).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 0);
    harness.control.send(1, TOPIC, 0, 1);
    let failed = harness.next_started().await;
    let unfinished = harness.next_started().await;

    failed.fatal();
    let error = harness.coordinator.await.unwrap().unwrap_err();
    assert!(matches!(error, ParallelConsumerError::Processing(_)));
    assert!(unfinished.completion.send(Ok(())).is_err());
    assert!(harness.control.commits().is_empty());
}

#[tokio::test]
async fn commit_submission_failure_is_fatal_and_does_not_cross_unfinished_work() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 3).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 40);
    harness.control.send(1, TOPIC, 0, 41);
    let first = harness.next_started().await;
    let unfinished = harness.next_started().await;
    harness.control.fail_commit();

    first.commit_safe();
    let error = harness.coordinator.await.unwrap().unwrap_err();
    assert!(matches!(error, ParallelConsumerError::Commit(_)));
    assert!(unfinished.completion.send(Ok(())).is_err());
    assert!(harness.control.commits().is_empty());
}

#[tokio::test]
async fn pause_and_resume_failures_terminate_the_coordinator() {
    let mut pause_failure = Harness::start(ParallelConsumerConfig::new(1, 1).unwrap(), &[0]);
    pause_failure.control.fail_pause();
    pause_failure.control.send(0, TOPIC, 0, 0);
    let _started = pause_failure.next_started().await;
    let error = pause_failure.coordinator.await.unwrap().unwrap_err();
    assert!(matches!(error, ParallelConsumerError::Pause(_)));
    assert!(pause_failure.control.commits().is_empty());

    let mut resume_failure = Harness::start(ParallelConsumerConfig::new(1, 1).unwrap(), &[0]);
    resume_failure.control.send(0, TOPIC, 0, 0);
    let started = resume_failure.next_started().await;
    wait_until(|| resume_failure.control.pause_calls() == 1).await;
    resume_failure.control.fail_resume();
    started.commit_safe();
    let error = resume_failure.coordinator.await.unwrap().unwrap_err();
    assert!(matches!(error, ParallelConsumerError::Resume(_)));
    assert_eq!(resume_failure.control.commits()[0].next_offset, 1);
}

#[tokio::test(start_paused = true)]
async fn saturated_consumer_keeps_polling_past_the_modeled_max_poll_interval() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(1, 1).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 0);
    let first = harness.next_started().await;
    wait_until(|| harness.control.pause_calls() == 1).await;
    let polls_before = harness.control.receive_polls();

    tokio::time::advance(Duration::from_secs(120)).await;
    settle().await;
    assert!(harness.control.receive_polls() > polls_before);
    assert_eq!(harness.control.resume_calls(), 0);

    first.commit_safe();
    wait_until(|| harness.control.resume_calls() == 1).await;
    harness.control.send(1, TOPIC, 0, 1);
    assert_eq!(harness.next_started().await.id, 1);
    harness.stop().await;
}

#[tokio::test]
async fn deliveries_racing_pause_are_accepted_through_the_hard_ceiling() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 2).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 0);
    harness.control.send(1, TOPIC, 0, 1);
    let first = harness.next_started().await;
    let second = harness.next_started().await;
    wait_until(|| harness.control.pause_calls() == 1).await;

    harness.control.send(2, TOPIC, 0, 2);
    harness.control.send(3, TOPIC, 0, 3);
    settle().await;
    assert!(!harness.coordinator.is_finished());
    harness.assert_no_work_started();

    first.commit_safe();
    second.commit_safe();
    let third = harness.next_started().await;
    let fourth = harness.next_started().await;
    assert_eq!([third.id, fourth.id], [2, 3]);
    assert_eq!(harness.control.resume_calls(), 0);

    third.commit_safe();
    wait_until(|| harness.control.resume_calls() == 1).await;
    harness.stop().await;
}

#[tokio::test]
async fn deliveries_beyond_pause_race_allowance_are_fatal() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 2).unwrap(), &[0]);
    for id in 0..5 {
        harness.control.send(id, TOPIC, 0, id as i64);
    }
    let first = harness.next_started().await;
    let second = harness.next_started().await;

    let error = harness.coordinator.await.unwrap().unwrap_err();
    assert!(matches!(
        error,
        ParallelConsumerError::OutstandingHardLimitExceeded {
            outstanding: 5,
            hard_limit: 4,
        }
    ));
    assert!(first.completion.send(Ok(())).is_err());
    assert!(second.completion.send(Ok(())).is_err());
    assert!(harness.control.commits().is_empty());
}

#[tokio::test]
async fn incremental_revocation_cancels_only_moved_partition_and_releases_its_slot() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 4).unwrap(), &[0, 1]);
    let retained_epoch = harness.control.epoch(TOPIC, 1).unwrap();
    harness.control.send(0, TOPIC, 0, 0);
    harness.control.send(1, TOPIC, 1, 10);
    let revoked = harness.next_started().await;
    let retained = harness.next_started().await;

    harness.control.revoke(TOPIC, 0);
    harness.control.send(2, TOPIC, 1, 11);
    let refill = harness.next_started().await;
    assert_eq!(refill.id, 2);
    assert_eq!(harness.control.epoch(TOPIC, 1), Some(retained_epoch));
    settle().await;
    assert!(revoked.completion.send(Ok(())).is_err());

    retained.commit_safe();
    refill.commit_safe();
    wait_until(|| !harness.control.commits().is_empty()).await;
    assert!(
        harness
            .control
            .commits()
            .iter()
            .all(|commit| commit.topic_partition.partition == 1)
    );
    harness.stop().await;
}

#[tokio::test]
async fn full_revocation_cancels_all_work_and_releases_all_capacity() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 4).unwrap(), &[0, 1]);
    harness.control.send(0, TOPIC, 0, 0);
    harness.control.send(1, TOPIC, 1, 0);
    let first = harness.next_started().await;
    let second = harness.next_started().await;

    harness.control.revoke(TOPIC, 0);
    harness.control.revoke(TOPIC, 1);
    settle().await;
    assert!(first.completion.send(Ok(())).is_err());
    assert!(second.completion.send(Ok(())).is_err());
    assert!(harness.control.commits().is_empty());

    harness.control.assign(TOPIC, 2);
    harness.control.assign(TOPIC, 3);
    harness.control.send(2, TOPIC, 2, 5);
    harness.control.send(3, TOPIC, 3, 8);
    assert_eq!(harness.next_started().await.id, 2);
    assert_eq!(harness.next_started().await.id, 3);
    harness.stop().await;
}

#[tokio::test]
async fn revocation_discards_completed_offsets_waiting_behind_a_gap() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(2, 3).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 3);
    harness.control.send(1, TOPIC, 0, 9);
    let gap = harness.next_started().await;
    let completed_later = harness.next_started().await;
    completed_later.commit_safe();
    settle().await;
    assert!(harness.control.commits().is_empty());

    harness.control.revoke(TOPIC, 0);
    settle().await;
    assert!(gap.completion.send(Ok(())).is_err());
    assert!(harness.control.commits().is_empty());
    harness.stop().await;
}

#[tokio::test]
async fn repeated_rebalances_and_same_partition_reassignment_fence_old_epochs() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(1, 2).unwrap(), &[0]);

    for cycle in 0..3 {
        harness.control.send(cycle, TOPIC, 0, cycle as i64);
        let old_work = harness.next_started().await;
        let old_epoch = harness.control.epoch(TOPIC, 0).unwrap();
        harness.control.revoke(TOPIC, 0);
        let new_epoch = harness.control.assign(TOPIC, 0);
        assert!(new_epoch > old_epoch);
        settle().await;
        assert!(old_work.completion.send(Ok(())).is_err());
    }

    harness.control.send(100, TOPIC, 0, 0);
    let current_work = harness.next_started().await;
    current_work.commit_safe();
    wait_until(|| harness.control.commits().len() == 1).await;
    assert_eq!(harness.control.commits()[0].next_offset, 1);
    harness.stop().await;
}

#[tokio::test]
async fn stale_completion_ready_during_reassignment_cannot_commit_new_epoch() {
    let mut harness = Harness::start(ParallelConsumerConfig::new(1, 2).unwrap(), &[0]);
    harness.control.send(0, TOPIC, 0, 50);
    let old_work = harness.next_started().await;
    old_work.commit_safe();
    harness.control.revoke(TOPIC, 0);
    harness.control.assign(TOPIC, 0);
    settle().await;
    assert!(harness.control.commits().is_empty());

    harness.control.send(1, TOPIC, 0, 50);
    let new_work = harness.next_started().await;
    new_work.commit_safe();
    wait_until(|| harness.control.commits().len() == 1).await;
    assert_eq!(harness.control.commits()[0].next_offset, 51);
    harness.stop().await;
}

#[derive(Clone, Copy)]
struct TableReceipt {
    id: u64,
    partition: i32,
    offset: i64,
}

#[tokio::test]
async fn table_driven_completion_orders_preserve_state_machine_invariants() {
    let cases: &[(&[TableReceipt], &[u64])] = &[
        (
            &[
                TableReceipt {
                    id: 0,
                    partition: 0,
                    offset: 2,
                },
                TableReceipt {
                    id: 1,
                    partition: 0,
                    offset: 8,
                },
                TableReceipt {
                    id: 2,
                    partition: 0,
                    offset: 20,
                },
            ],
            &[2, 0, 1],
        ),
        (
            &[
                TableReceipt {
                    id: 0,
                    partition: 0,
                    offset: 10,
                },
                TableReceipt {
                    id: 1,
                    partition: 1,
                    offset: 4,
                },
                TableReceipt {
                    id: 2,
                    partition: 0,
                    offset: 14,
                },
                TableReceipt {
                    id: 3,
                    partition: 1,
                    offset: 12,
                },
            ],
            &[3, 2, 1, 0],
        ),
        (
            &[
                TableReceipt {
                    id: 0,
                    partition: 0,
                    offset: 0,
                },
                TableReceipt {
                    id: 1,
                    partition: 1,
                    offset: 100,
                },
                TableReceipt {
                    id: 2,
                    partition: 2,
                    offset: 7,
                },
            ],
            &[1, 0, 2],
        ),
    ];

    for (receipts, completion_order) in cases {
        let partitions = receipts
            .iter()
            .map(|receipt| receipt.partition)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut harness = Harness::start(
            ParallelConsumerConfig::new(receipts.len(), receipts.len()).unwrap(),
            &partitions,
        );
        for receipt in *receipts {
            harness
                .control
                .send(receipt.id, TOPIC, receipt.partition, receipt.offset);
        }
        let mut started = HashMap::new();
        for _ in 0..receipts.len() {
            let work = harness.next_started().await;
            started.insert(work.id, work);
        }

        let mut completed = HashSet::new();
        let mut checked_commits = 0;
        let mut last_commit_by_partition = HashMap::new();
        for id in *completion_order {
            started.remove(id).unwrap().commit_safe();
            completed.insert(*id);
            settle().await;

            let commits = harness.control.commits();
            for commit in &commits[checked_commits..] {
                if let Some(previous) = last_commit_by_partition
                    .insert(commit.topic_partition.partition, commit.next_offset)
                {
                    assert!(commit.next_offset >= previous);
                }
                let committed_receipt = receipts
                    .iter()
                    .find(|receipt| {
                        receipt.partition == commit.topic_partition.partition
                            && receipt.offset + 1 == commit.next_offset
                    })
                    .unwrap();
                for receipt in receipts
                    .iter()
                    .take_while(|receipt| receipt.id != committed_receipt.id)
                {
                    if receipt.partition == committed_receipt.partition {
                        assert!(completed.contains(&receipt.id));
                    }
                }
                assert!(completed.contains(&committed_receipt.id));
            }
            checked_commits = commits.len();
        }

        let commits = harness.control.commits();
        for partition in &partitions {
            let expected = receipts
                .iter()
                .rev()
                .find(|receipt| receipt.partition == *partition)
                .unwrap()
                .offset
                + 1;
            assert_eq!(
                commits
                    .iter()
                    .rev()
                    .find(|commit| commit.topic_partition.partition == *partition)
                    .unwrap()
                    .next_offset,
                expected
            );
        }
        harness.stop().await;
    }
}
