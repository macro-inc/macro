use super::*;

const NOW_UNIX: i64 = 1_800_000_000;

fn partition(position: i64, pending: u64) -> PartitionProgress {
    PartitionProgress {
        topic: "macro.documents".to_owned(),
        partition: 0,
        broker_up: true,
        position: Some(position),
        pending: Some(pending),
        prefetched: Some(0),
    }
}

fn sample(
    received_at: Instant,
    sampled_at: i64,
    partitions: Vec<PartitionProgress>,
) -> ProgressSample {
    ProgressSample {
        received_at,
        sampled_at,
        partitions,
    }
}

#[test]
fn a_fresh_caught_up_sample_is_progressing_even_without_a_previous_one() {
    let now = Instant::now();
    let current = sample(now, NOW_UNIX, vec![partition(10, 0)]);

    assert_eq!(
        assess(None, Some(&current), now, NOW_UNIX),
        Progress::Progressing
    );
}

#[test]
fn no_sample_yet_is_not_progressing() {
    assert_eq!(
        assess(None, None, Instant::now(), NOW_UNIX),
        Progress::NoSample
    );
}

#[test]
fn a_sample_received_long_ago_is_stale() {
    let received = Instant::now();
    let now = received + STALE_AFTER;
    let current = sample(received, NOW_UNIX, vec![partition(10, 0)]);

    assert_eq!(assess(None, Some(&current), now, NOW_UNIX), Progress::Stale);
}

#[test]
fn a_sample_taken_long_ago_but_delivered_now_is_stale() {
    let now = Instant::now();
    let taken = NOW_UNIX - i64::try_from(STALE_AFTER.as_secs()).unwrap();
    let current = sample(now, taken, vec![partition(10, 0)]);

    assert_eq!(assess(None, Some(&current), now, NOW_UNIX), Progress::Stale);
}

#[test]
fn a_partition_whose_broker_is_down_is_disconnected() {
    let now = Instant::now();
    let mut down = partition(10, 0);
    down.broker_up = false;
    let current = sample(now, NOW_UNIX, vec![partition(3, 0), down]);

    assert_eq!(
        assess(None, Some(&current), now, NOW_UNIX),
        Progress::Disconnected
    );
}

#[test]
fn a_backlog_whose_position_did_not_move_is_stuck() {
    let now = Instant::now();
    let previous = sample(now, NOW_UNIX - 10, vec![partition(10, 5)]);
    let current = sample(now, NOW_UNIX, vec![partition(10, 7)]);

    assert_eq!(
        assess(Some(&previous), Some(&current), now, NOW_UNIX),
        Progress::Stuck
    );
}

#[test]
fn a_backlog_whose_position_moved_is_progressing() {
    let now = Instant::now();
    let previous = sample(now, NOW_UNIX - 10, vec![partition(10, 5)]);
    let current = sample(now, NOW_UNIX, vec![partition(14, 3)]);

    assert_eq!(
        assess(Some(&previous), Some(&current), now, NOW_UNIX),
        Progress::Progressing
    );
}

#[test]
fn a_backlog_with_nothing_to_compare_against_is_stuck() {
    let now = Instant::now();
    let current = sample(now, NOW_UNIX, vec![partition(10, 5)]);

    assert_eq!(assess(None, Some(&current), now, NOW_UNIX), Progress::Stuck);
}

#[test]
fn an_unknown_position_or_no_partitions_is_not_progressing() {
    let now = Instant::now();
    let mut unknown = partition(10, 0);
    unknown.pending = None;

    assert_eq!(
        assess(
            None,
            Some(&sample(now, NOW_UNIX, vec![unknown])),
            now,
            NOW_UNIX
        ),
        Progress::Unknown
    );
    assert_eq!(
        assess(
            None,
            Some(&sample(now, NOW_UNIX, Vec::new())),
            now,
            NOW_UNIX
        ),
        Progress::Unassigned
    );
}

/// An idle consumer started at the latest offsets reads as progressing from
/// real librdkafka samples, so a quiet stream still gets heartbeats.
#[tokio::test]
async fn an_idle_consumer_at_the_latest_offsets_is_progressing() {
    use crate::statistics::{StatisticsContext, offset_resets_counter};
    use rdkafka::consumer::{Consumer as _, DefaultConsumerContext, StreamConsumer};
    use rdkafka::mocking::MockCluster;
    use std::sync::{Arc, Mutex};

    let cluster = MockCluster::new(1).expect("mock broker");
    cluster.create_topic("idle-a", 2, 1).expect("topic");
    cluster.create_topic("idle-b", 1, 1).expect("topic");
    let latest: Arc<Mutex<Option<ProgressSample>>> = Arc::default();
    let observer: crate::ConsumerStatistics = Arc::new({
        let latest = Arc::clone(&latest);
        move |stats| {
            *latest.lock().expect("sample lock") = Some(ProgressSample::new(stats, Instant::now()));
        }
    });
    let mut config = crate::ungrouped_config(&cluster.bootstrap_servers());
    config.set("statistics.interval.ms", "50");
    let consumer: StreamConsumer<_> = config
        .create_with_context(StatisticsContext {
            inner: DefaultConsumerContext,
            offset_resets: offset_resets_counter(),
            observer: Some(observer),
        })
        .expect("consumer");
    let mut assignment = rdkafka::TopicPartitionList::new();
    for (topic, partition) in [("idle-a", 0), ("idle-a", 1), ("idle-b", 0)] {
        assignment
            .add_partition_offset(topic, partition, rdkafka::Offset::End)
            .expect("assignment");
    }
    consumer.assign(&assignment).expect("manual assignment");

    assert!(
        tokio::time::timeout(Duration::from_secs(2), consumer.recv())
            .await
            .is_err(),
        "nothing was published"
    );

    let sample = latest
        .lock()
        .expect("sample lock")
        .clone()
        .expect("a sample");
    let unix_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after the epoch")
        .as_secs();
    assert_eq!(sample.partitions.len(), 3, "{sample:?}");
    assert_eq!(
        assess(
            None,
            Some(&sample),
            Instant::now(),
            i64::try_from(unix_now).unwrap()
        ),
        Progress::Progressing,
        "{sample:?}"
    );
}
