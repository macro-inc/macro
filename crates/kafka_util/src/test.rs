use super::*;

struct TestConsumerGroup;

impl GroupName for TestConsumerGroup {
    const GROUP_NAME: &'static str = "consumer-group";
}

fn topic_partition_list(partitions: &[(&str, i32)]) -> TopicPartitionList {
    let mut list = TopicPartitionList::with_capacity(partitions.len());
    for (topic, partition) in partitions {
        list.add_partition(topic, *partition);
    }
    list
}

fn find_assignment<'a>(
    assignments: &'a [PartitionAssignment],
    topic: &str,
    partition: i32,
) -> &'a PartitionAssignment {
    assignments
        .iter()
        .find(|assignment| {
            assignment.topic_partition.topic == topic
                && assignment.topic_partition.partition == partition
        })
        .expect("expected topic-partition assignment")
}

#[test]
fn producer_config_uses_brokers_and_message_timeout() {
    let config = producer_config("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("message.timeout.ms"), Some(MESSAGE_TIMEOUT_MS));
    assert_eq!(config.get("enable.auto.commit"), None);
}

#[test]
fn grouped_config_uses_named_group_manual_commits_and_earliest_offsets() {
    let config = grouped_config::<TestConsumerGroup>("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("group.id"), Some("consumer-group"));
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("auto.offset.reset"), Some("earliest"));
    assert_eq!(config.get("max.poll.interval.ms"), None);
    assert_eq!(config.get("partition.assignment.strategy"), None);
}

#[test]
fn cooperative_grouped_config_sets_max_poll_interval_without_changing_group_defaults() {
    let config = grouped_config_with_max_poll_interval::<TestConsumerGroup>(
        "broker-a:9092,broker-b:9092",
        Duration::from_secs(420),
    )
    .unwrap();

    assert_eq!(config.get("group.id"), Some("consumer-group"));
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("auto.offset.reset"), Some("earliest"));
    assert_eq!(config.get("max.poll.interval.ms"), Some("420000"));
    assert_eq!(
        config.get("partition.assignment.strategy"),
        Some(COOPERATIVE_ASSIGNMENT_STRATEGY)
    );
}

#[test]
fn max_poll_interval_conversion_rounds_up_and_rejects_librdkafka_out_of_range_values() {
    let rounded = grouped_config_with_max_poll_interval::<TestConsumerGroup>(
        "broker:9092",
        Duration::from_nanos(1),
    )
    .unwrap();
    let maximum = grouped_config_with_max_poll_interval::<TestConsumerGroup>(
        "broker:9092",
        Duration::from_millis(MAX_LIBRDKAFKA_POLL_INTERVAL_MS as u64),
    )
    .unwrap();

    assert_eq!(rounded.get("max.poll.interval.ms"), Some("1"));
    assert_eq!(maximum.get("max.poll.interval.ms"), Some("86400000"));
    assert!(matches!(
        grouped_config_with_max_poll_interval::<TestConsumerGroup>("broker:9092", Duration::ZERO),
        Err(KafkaConsumerError::InvalidMaxPollInterval(Duration::ZERO))
    ));
    assert!(matches!(
        grouped_config_with_max_poll_interval::<TestConsumerGroup>(
            "broker:9092",
            Duration::from_millis((MAX_LIBRDKAFKA_POLL_INTERVAL_MS + 1) as u64)
        ),
        Err(KafkaConsumerError::InvalidMaxPollInterval(_))
    ));
}

#[test]
fn ungrouped_config_uses_unique_internal_groups_without_offset_storage() {
    let first = ungrouped_config("broker:9092");
    let second = ungrouped_config("broker:9092");
    let first_group = first.get("group.id").unwrap();
    let second_group = second.get("group.id").unwrap();

    assert!(first_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert!(second_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert_ne!(first_group, second_group);
    assert_eq!(first.get("enable.auto.commit"), Some("false"));
    assert_eq!(first.get("enable.auto.offset.store"), Some("false"));
    assert_eq!(first.get("auto.offset.reset"), None);
    assert_eq!(first.get("partition.assignment.strategy"), None);
}

#[test]
fn ungrouped_initial_offsets_are_explicit() {
    assert_eq!(InitialOffset::Earliest.as_kafka_offset(), Offset::Beginning);
    assert_eq!(InitialOffset::Latest.as_kafka_offset(), Offset::End);
}

#[test]
fn exact_offset_list_uses_kafka_next_offset_convention() {
    let completed_offset = 41;
    let commit_offset = next_offset(completed_offset).unwrap();
    let offsets = build_partition_offset_list("events", 3, commit_offset).unwrap();
    let element = offsets.elements().pop().unwrap();

    assert_eq!(offsets.count(), 1);
    assert_eq!(element.topic(), "events");
    assert_eq!(element.partition(), 3);
    assert_eq!(element.offset(), Offset::Offset(42));
}

#[test]
fn exact_offset_construction_rejects_invalid_values() {
    assert!(matches!(
        build_partition_offset_list("events", 3, -1),
        Err(KafkaError::SetPartitionOffset(
            RDKafkaErrorCode::InvalidArgument
        ))
    ));
    assert!(matches!(
        build_partition_offset_list("events", -1, 1),
        Err(KafkaError::Subscription(_))
    ));
    assert!(matches!(
        build_partition_offset_list("", 0, 1),
        Err(KafkaError::Subscription(_))
    ));
    assert!(matches!(
        build_partition_offset_list("invalid\0topic", 0, 1),
        Err(KafkaError::Nul(_))
    ));
    assert!(matches!(
        next_offset(-1),
        Err(KafkaError::SetPartitionOffset(
            RDKafkaErrorCode::InvalidArgument
        ))
    ));
}

#[test]
fn completed_offset_conversion_checks_the_i64_boundary() {
    assert_eq!(next_offset(i64::MAX - 1).unwrap(), i64::MAX);
    assert!(build_partition_offset_list("events", 0, i64::MAX).is_ok());
    assert!(matches!(
        next_offset(i64::MAX),
        Err(KafkaError::SetPartitionOffset(
            RDKafkaErrorCode::InvalidArgument
        ))
    ));
}

#[derive(Clone, Copy)]
enum AssignmentFailure {
    None,
    Assignment,
    Pause,
    Resume,
}

struct FakeAssignmentControl {
    assignment: TopicPartitionList,
    failure: AssignmentFailure,
    paused: Mutex<Option<TopicPartitionList>>,
    resumed: Mutex<Option<TopicPartitionList>>,
}

impl FakeAssignmentControl {
    fn new(assignment: TopicPartitionList, failure: AssignmentFailure) -> Self {
        Self {
            assignment,
            failure,
            paused: Mutex::new(None),
            resumed: Mutex::new(None),
        }
    }
}

impl AssignmentControl for FakeAssignmentControl {
    fn assignment(&self) -> KafkaResult<TopicPartitionList> {
        if matches!(self.failure, AssignmentFailure::Assignment) {
            return Err(KafkaError::Subscription("assignment failed".to_string()));
        }
        Ok(self.assignment.clone())
    }

    fn pause(&self, partitions: &TopicPartitionList) -> KafkaResult<()> {
        if matches!(self.failure, AssignmentFailure::Pause) {
            return Err(KafkaError::PauseResume("pause failed".to_string()));
        }
        *lock_unpoisoned(&self.paused) = Some(partitions.clone());
        Ok(())
    }

    fn resume(&self, partitions: &TopicPartitionList) -> KafkaResult<()> {
        if matches!(self.failure, AssignmentFailure::Resume) {
            return Err(KafkaError::PauseResume("resume failed".to_string()));
        }
        *lock_unpoisoned(&self.resumed) = Some(partitions.clone());
        Ok(())
    }
}

#[test]
fn pause_and_resume_use_offset_free_copies_of_the_current_assignment() {
    let mut assignment = TopicPartitionList::new();
    assignment
        .add_partition_offset("events", 2, Offset::Offset(17))
        .unwrap();
    let consumer = FakeAssignmentControl::new(assignment, AssignmentFailure::None);

    pause_consumer_assignment(&consumer).unwrap();
    resume_consumer_assignment(&consumer).unwrap();

    let paused = lock_unpoisoned(&consumer.paused);
    let paused = paused.as_ref().unwrap();
    let resumed = lock_unpoisoned(&consumer.resumed);
    let resumed = resumed.as_ref().unwrap();
    assert_eq!(paused.count(), 1);
    assert_eq!(paused.elements()[0].offset(), Offset::Invalid);
    assert_eq!(resumed.count(), 1);
    assert_eq!(resumed.elements()[0].offset(), Offset::Invalid);
}

#[test]
fn pause_and_resume_propagate_assignment_and_operation_failures() {
    let assignment_failure = FakeAssignmentControl::new(
        topic_partition_list(&[("events", 0)]),
        AssignmentFailure::Assignment,
    );
    let pause_failure = FakeAssignmentControl::new(
        topic_partition_list(&[("events", 0)]),
        AssignmentFailure::Pause,
    );
    let resume_failure = FakeAssignmentControl::new(
        topic_partition_list(&[("events", 0)]),
        AssignmentFailure::Resume,
    );

    assert!(matches!(
        pause_consumer_assignment(&assignment_failure),
        Err(KafkaError::Subscription(_))
    ));
    assert!(matches!(
        pause_consumer_assignment(&pause_failure),
        Err(KafkaError::PauseResume(_))
    ));
    assert!(matches!(
        resume_consumer_assignment(&resume_failure),
        Err(KafkaError::PauseResume(_))
    ));
}

#[test]
fn cooperative_rebalances_track_incremental_assignments_and_revocations() {
    let tracker = RebalanceTracker::new();
    let mut events = tracker.take_events().unwrap();
    let initial = topic_partition_list(&[("events", 0), ("events", 1)]);
    tracker.observe_post_rebalance(&Rebalance::Assign(&initial));
    let initial_assignments = tracker.current_assignments();
    let retained_epoch = find_assignment(&initial_assignments, "events", 1).epoch;
    let revoked_epoch = find_assignment(&initial_assignments, "events", 0).epoch;

    let incremental_assignment = topic_partition_list(&[("events", 2)]);
    tracker.observe_post_rebalance(&Rebalance::Assign(&incremental_assignment));
    let incremental_revocation = topic_partition_list(&[("events", 0)]);
    tracker.observe_pre_rebalance(&Rebalance::Revoke(&incremental_revocation));

    assert!(matches!(
        events.try_recv().unwrap(),
        RebalanceEvent::Assigned(assignments) if assignments.len() == 2
    ));
    assert!(matches!(
        events.try_recv().unwrap(),
        RebalanceEvent::Assigned(assignments)
            if assignments.len() == 1
                && assignments[0].topic_partition.partition == 2
    ));
    assert!(matches!(
        events.try_recv().unwrap(),
        RebalanceEvent::Revoked(assignments)
            if assignments.len() == 1
                && assignments[0].topic_partition.partition == 0
                && assignments[0].epoch > revoked_epoch
    ));

    let current = tracker.current_assignments();
    assert_eq!(current.len(), 2);
    assert_eq!(find_assignment(&current, "events", 1).epoch, retained_epoch);
    assert!(find_assignment(&current, "events", 2).epoch.value() > 0);
    assert!(!tracker.is_current_assignment("events", 0, revoked_epoch));
}

#[test]
fn full_assignment_revocation_fences_every_partition() {
    let tracker = RebalanceTracker::new();
    let mut events = tracker.take_events().unwrap();
    let assignment = topic_partition_list(&[("events", 0), ("events", 1)]);
    tracker.observe_post_rebalance(&Rebalance::Assign(&assignment));
    let old_assignments = tracker.current_assignments();

    tracker.observe_pre_rebalance(&Rebalance::Revoke(&assignment));

    let _ = events.try_recv().unwrap();
    let RebalanceEvent::Revoked(revoked) = events.try_recv().unwrap() else {
        panic!("expected full revocation event");
    };
    assert_eq!(revoked.len(), 2);
    assert!(tracker.current_assignments().is_empty());
    for assignment in old_assignments {
        assert!(!tracker.is_current_assignment(
            &assignment.topic_partition.topic,
            assignment.topic_partition.partition,
            assignment.epoch,
        ));
    }
}

#[test]
fn same_partition_reassignment_receives_a_new_epoch() {
    let tracker = RebalanceTracker::new();
    let assignment = topic_partition_list(&[("events", 0)]);
    tracker.observe_post_rebalance(&Rebalance::Assign(&assignment));
    let first_epoch = tracker.current_assignments()[0].epoch;

    tracker.observe_pre_rebalance(&Rebalance::Revoke(&assignment));
    assert!(!tracker.is_current_assignment("events", 0, first_epoch));
    tracker.observe_post_rebalance(&Rebalance::Assign(&assignment));

    let second_epoch = tracker.current_assignments()[0].epoch;
    assert!(second_epoch > first_epoch);
    assert!(tracker.is_current_assignment("events", 0, second_epoch));
    assert!(!tracker.is_current_assignment("events", 0, first_epoch));
}

#[test]
fn plaintext_and_msk_contexts_forward_rebalance_callbacks() {
    let assignment = topic_partition_list(&[("events", 0)]);

    let plaintext_tracker = RebalanceTracker::new();
    let mut plaintext_events = plaintext_tracker.take_events().unwrap();
    let plaintext = PlaintextConsumerContext::with_rebalance_tracker(plaintext_tracker);
    plaintext.observe_post_rebalance(&Rebalance::Assign(&assignment));
    plaintext.observe_pre_rebalance(&Rebalance::Revoke(&assignment));
    assert!(matches!(
        plaintext_events.try_recv().unwrap(),
        RebalanceEvent::Assigned(_)
    ));
    assert!(matches!(
        plaintext_events.try_recv().unwrap(),
        RebalanceEvent::Revoked(_)
    ));

    let msk_tracker = RebalanceTracker::new();
    let mut msk_events = msk_tracker.take_events().unwrap();
    let msk = MskIamClientContext::from_env_with_rebalance_tracker(msk_tracker);
    msk.observe_post_rebalance(&Rebalance::Assign(&assignment));
    msk.observe_pre_rebalance(&Rebalance::Revoke(&assignment));
    assert!(matches!(
        msk_events.try_recv().unwrap(),
        RebalanceEvent::Assigned(_)
    ));
    assert!(matches!(
        msk_events.try_recv().unwrap(),
        RebalanceEvent::Revoked(_)
    ));
}

#[tokio::test]
async fn existing_and_cooperative_constructors_select_rebalance_observation_without_a_broker() {
    let existing = KafkaEventConsumer::<TestConsumerGroup>::from_env("localhost:1").unwrap();
    let cooperative = KafkaEventConsumer::<TestConsumerGroup>::from_env_with_max_poll_interval(
        "localhost:1",
        Duration::from_secs(60),
    )
    .unwrap();

    assert!(existing.rebalance_tracker().is_none());
    assert!(cooperative.rebalance_tracker().is_some());
}

#[test]
fn existing_contexts_without_a_tracker_ignore_rebalances() {
    let assignment = topic_partition_list(&[("events", 0)]);
    let plaintext = PlaintextConsumerContext::default();
    let msk = MskIamClientContext::from_env();

    plaintext.observe_post_rebalance(&Rebalance::Assign(&assignment));
    plaintext.observe_pre_rebalance(&Rebalance::Revoke(&assignment));
    msk.observe_post_rebalance(&Rebalance::Assign(&assignment));
    msk.observe_pre_rebalance(&Rebalance::Revoke(&assignment));

    assert!(plaintext.rebalance_tracker.is_none());
    assert!(!msk.has_rebalance_tracker());
}
