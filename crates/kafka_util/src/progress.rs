//! Whether a consumer is making progress, judged from its statistics samples.
//!
//! librdkafka delivers statistics only while the application polls the
//! consumer, so a fresh sample shows the receive loop is alive even when no
//! records arrive. Freshness alone cannot tell a broker outage or a partition
//! that stopped advancing, so [`assess`] also checks every assigned partition.

use std::time::{Duration, Instant};

use rdkafka::statistics::{Partition, Statistics};

#[cfg(test)]
mod test;

/// How old the newest sample may be before the consumer counts as stalled:
/// three of [`crate::KafkaEventConsumer::from_env_with_statistics`]'s intervals.
pub const STALE_AFTER: Duration = Duration::from_secs(30);

/// One assigned partition as a statistics sample saw it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartitionProgress {
    /// Topic name.
    pub topic: String,
    /// Partition number.
    pub partition: i32,
    /// Whether this partition's own broker connection is up. Another
    /// partition's healthy connection says nothing about this one's cached
    /// high watermark.
    pub broker_up: bool,
    /// The next offset the application receives: its delivered position, or
    /// before the first delivery the next offset librdkafka fetches.
    pub position: Option<i64>,
    /// Records between the position and the high watermark, plus any already
    /// prefetched before the first delivery. `None` while unknown.
    pub pending: Option<u64>,
    /// Records fetched but not yet received by the application.
    pub prefetched: Option<u64>,
}

impl PartitionProgress {
    fn new(topic: &str, partition: &Partition, stats: &Statistics) -> Self {
        let broker_up = stats
            .brokers
            .values()
            .any(|broker| broker.nodeid == partition.broker && broker.state == "UP");
        // app_offset is next-to-deliver; an ungrouped consumer never commits.
        // Before the first delivery use next-to-fetch plus the prefetched
        // queue, so an idle partition started at the latest offset reads zero.
        let (position, queued) = if partition.app_offset >= 0 {
            (partition.app_offset, 0)
        } else {
            (partition.next_offset, partition.fetchq_cnt)
        };
        let pending = (position >= 0 && partition.hi_offset >= position && queued >= 0)
            .then(|| (partition.hi_offset - position).checked_add(queued))
            .flatten()
            .and_then(|value| u64::try_from(value).ok());
        Self {
            topic: topic.to_owned(),
            partition: partition.partition,
            broker_up,
            position: (position >= 0).then_some(position),
            pending,
            prefetched: u64::try_from(partition.fetchq_cnt).ok(),
        }
    }
}

/// The partitions a consumer is assigned, as `stats` saw them.
pub fn assigned_partitions(stats: &Statistics) -> Vec<PartitionProgress> {
    stats
        .topics
        .iter()
        .flat_map(|(topic, statistics)| {
            statistics
                .partitions
                .values()
                .filter(|partition| partition.partition >= 0 && partition.desired)
                .map(move |partition| PartitionProgress::new(topic, partition, stats))
        })
        .collect()
}

/// One statistics sample, reduced to what [`assess`] needs.
#[derive(Clone, Debug)]
pub struct ProgressSample {
    /// When this process received the sample.
    pub received_at: Instant,
    /// When librdkafka took it, in Unix seconds.
    pub sampled_at: i64,
    /// Every assigned partition.
    pub partitions: Vec<PartitionProgress>,
}

impl ProgressSample {
    /// Reduce `stats`, received at `received_at`.
    pub fn new(stats: &Statistics, received_at: Instant) -> Self {
        Self {
            received_at,
            sampled_at: stats.time,
            partitions: assigned_partitions(stats),
        }
    }
}

/// Whether a consumer is making progress, or why not.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum Progress {
    /// Polled recently, connected, and every partition caught up or advancing.
    Progressing,
    /// No sample has arrived yet.
    NoSample,
    /// The newest sample is older than [`STALE_AFTER`]: nothing is polling.
    Stale,
    /// The consumer is assigned no partitions.
    Unassigned,
    /// A partition's broker connection is down.
    Disconnected,
    /// A partition's position or high watermark is not known yet.
    Unknown,
    /// A partition has records waiting and did not advance since the
    /// previous sample.
    Stuck,
}

/// Judge `current` against the sample before it.
///
/// `now` and `unix_now` are the same moment on the monotonic and Unix clocks.
/// A sample librdkafka took long ago but delivered just now is stale too: it
/// queues callbacks while nothing polls, and delivers them on the next poll.
pub fn assess(
    previous: Option<&ProgressSample>,
    current: Option<&ProgressSample>,
    now: Instant,
    unix_now: i64,
) -> Progress {
    let Some(current) = current else {
        return Progress::NoSample;
    };
    if now.saturating_duration_since(current.received_at) >= STALE_AFTER
        || unix_now.saturating_sub(current.sampled_at).unsigned_abs() >= STALE_AFTER.as_secs()
    {
        return Progress::Stale;
    }
    if current.partitions.is_empty() {
        return Progress::Unassigned;
    }
    if current
        .partitions
        .iter()
        .any(|partition| !partition.broker_up)
    {
        return Progress::Disconnected;
    }
    let mut stuck = false;
    for partition in &current.partitions {
        let (Some(pending), Some(position)) = (partition.pending, partition.position) else {
            return Progress::Unknown;
        };
        if pending == 0 {
            continue;
        }
        let advanced = previous
            .and_then(|previous| {
                previous.partitions.iter().find(|earlier| {
                    earlier.topic == partition.topic && earlier.partition == partition.partition
                })
            })
            .and_then(|earlier| earlier.position)
            .is_some_and(|earlier| earlier < position);
        stuck |= !advanced;
    }
    if stuck {
        Progress::Stuck
    } else {
        Progress::Progressing
    }
}
