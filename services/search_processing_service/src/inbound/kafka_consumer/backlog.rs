//! The age of each assigned partition's oldest unprocessed record, sampled
//! every [`SAMPLE_INTERVAL`] into
//! [`OLDEST_PENDING`](super::metrics::OLDEST_PENDING).
//!
//! A partition's next unprocessed record is either one the consumer took and
//! has not finished, which the [`OffsetLedger`] holds with its Kafka
//! timestamp, or the first one the application has not received: in
//! librdkafka's prefetch queue or still on the broker. That one has no
//! timestamp until it is received, so its age counts from the first sample
//! whose cached high watermark was past it, when it already existed: at most
//! one interval low. Records that were already there at the partition's first
//! sample, a backlog inherited at assignment, have no such sample; once the
//! application has received from the partition, they count from the newest
//! record it received, which is at least as old. Until it has, the partition
//! counts as caught up at its first sample.
//!
//! The position and cached watermarks are the client's own state, kept by its
//! fetcher, so samples taken while the poll loop waits on a full worker
//! channel still show records piling up. A partition the client cannot fetch
//! at all keeps its last watermark, and records the broker holds past it stay
//! invisible here; the group's broker-side offset lag covers that case.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::{Duration, Instant},
};

use rdkafka::Offset;
use rootcause::Report;

#[cfg(test)]
mod test;

use super::{
    Lane, LaneConsumer,
    metrics::PendingAges,
    offsets::{OffsetLedger, RecordTime},
    subscribed_topic,
};

pub(super) const SAMPLE_INTERVAL: Duration = Duration::from_secs(10);
/// Watermark observations kept per partition, an hour of samples. Past it,
/// pairs merge and keep the earlier time, so after a long stall a record can
/// read up to one merged gap older than it is.
const HISTORY_LIMIT: usize = 360;

/// What one sample reads about one assigned partition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PartitionReading {
    pub(super) topic: &'static str,
    pub(super) partition: i32,
    /// The next offset the application will receive; `None` until it has
    /// received one since the partition was assigned.
    pub(super) position: Option<i64>,
    /// The high watermark as of the client's last fetch; `None` before one.
    pub(super) high_watermark: Option<i64>,
}

impl PartitionReading {
    /// A reading from the client's raw position and cached watermarks.
    pub(super) fn new(
        topic: &'static str,
        partition: i32,
        position: Offset,
        watermarks: Option<(i64, i64)>,
    ) -> Self {
        Self {
            topic,
            partition,
            position: match position {
                Offset::Offset(offset) => Some(offset),
                _ => None,
            },
            high_watermark: watermarks.map(|(_, high)| high).filter(|high| *high >= 0),
        }
    }
}

/// Samples one consumer's partitions into the shared [`PendingAges`], which
/// stop reporting them when the sampler is dropped with its consumer.
pub(super) struct BacklogSampler {
    ages: PendingAges,
    partitions: HashMap<(&'static str, i32), WatermarkHistory>,
}

impl BacklogSampler {
    pub(super) fn new(ages: PendingAges) -> Self {
        Self {
            ages,
            partitions: HashMap::new(),
        }
    }

    pub(super) fn sample_consumer<L: Lane>(
        &mut self,
        consumer: &LaneConsumer<L>,
        ledger: &OffsetLedger,
    ) {
        match read_partitions(consumer) {
            Ok(readings) => self.sample(
                chrono::Utc::now().timestamp_millis(),
                Instant::now(),
                &readings,
                ledger,
            ),
            Err(error) => tracing::warn!(
                error = ?error,
                "could not read the search processing consumer's positions; pending ages not sampled"
            ),
        }
    }

    /// Records each partition in `readings` at `now_ms`, and stops reporting
    /// partitions no longer among them.
    pub(super) fn sample(
        &mut self,
        now_ms: i64,
        sampled_at: Instant,
        readings: &[PartitionReading],
        ledger: &OffsetLedger,
    ) {
        let assigned: HashSet<_> = readings
            .iter()
            .map(|reading| (reading.topic, reading.partition))
            .collect();
        let ages = &self.ages;
        self.partitions.retain(|&(topic, partition), _| {
            let still_assigned = assigned.contains(&(topic, partition));
            if !still_assigned {
                ages.remove(topic, partition);
            }
            still_assigned
        });
        for reading in readings {
            let age_ms = self
                .partitions
                .entry((reading.topic, reading.partition))
                .or_default()
                .pending_age(
                    now_ms,
                    reading,
                    ledger.oldest_open(reading.topic, reading.partition),
                    ledger.newest_received(reading.topic, reading.partition),
                );
            ages.set(reading.topic, reading.partition, age_ms, sampled_at);
        }
    }
}

impl Drop for BacklogSampler {
    fn drop(&mut self) {
        for &(topic, partition) in self.partitions.keys() {
            self.ages.remove(topic, partition);
        }
    }
}

fn read_partitions<L: Lane>(consumer: &LaneConsumer<L>) -> Result<Vec<PartitionReading>, Report> {
    let consumer = consumer.inner();
    // The position list is the assignment, with each partition's position.
    let positions = consumer.position()?;
    Ok(positions
        .elements()
        .into_iter()
        .filter_map(|element| {
            let topic = subscribed_topic(element.topic())?;
            let partition = element.partition();
            Some(PartitionReading::new(
                topic,
                partition,
                element.offset(),
                consumer.cached_watermarks(topic, partition).ok(),
            ))
        })
        .collect())
}

#[derive(Debug, Default)]
struct WatermarkHistory {
    /// `(high watermark, unix ms)` pairs, both increasing: every record below
    /// the watermark existed by that time.
    seen: VecDeque<(i64, i64)>,
    /// The watermark at the partition's first sample: records below it were
    /// there before the sampler began.
    first_high_watermark: Option<i64>,
    /// The position at the previous sample.
    position: Option<i64>,
}

impl WatermarkHistory {
    fn pending_age(
        &mut self,
        now_ms: i64,
        reading: &PartitionReading,
        oldest_open: Option<RecordTime>,
        newest_received: Option<RecordTime>,
    ) -> u64 {
        // A position that went back to unset or moved back means the partition
        // was reassigned between samples, possibly after another owner's rewind.
        let reassigned = match (self.position, reading.position) {
            (Some(_), None) => true,
            (Some(before), Some(now)) => now < before,
            _ => false,
        };
        if reassigned {
            *self = Self::default();
        }
        self.position = reading.position;
        if let Some(high) = reading.high_watermark {
            self.first_high_watermark.get_or_insert(high);
            if self.seen.back().is_none_or(|&(last, _)| high > last) {
                self.seen.push_back((high, now_ms));
                if self.seen.len() > HISTORY_LIMIT {
                    self.thin();
                }
            }
        }
        let age_since = |since_ms: i64| u64::try_from(now_ms - since_ms).unwrap_or(0);

        // An open record at or past the position is left from before a
        // reassignment that moved the position back; the unreceived record at
        // the position is older.
        if let Some(open) = oldest_open.filter(|open| {
            reading
                .position
                .is_none_or(|position| open.offset < position)
        }) {
            self.forget_through(open.offset);
            return open
                .produced_at_ms
                .or_else(|| self.seen.front().map(|&(_, seen_at)| seen_at))
                .map_or(0, age_since);
        }
        let Some(position) = reading.position else {
            let first = self.first_high_watermark;
            return self
                .seen
                .iter()
                .find(|&&(high, _)| first.is_some_and(|first| high > first))
                .map_or(0, |&(_, seen_at)| age_since(seen_at));
        };
        self.forget_through(position);
        let Some(&(_, seen_at)) = self.seen.front() else {
            return 0;
        };
        let inherited = self
            .first_high_watermark
            .is_some_and(|first| position < first);
        match newest_received.and_then(|newest| newest.produced_at_ms) {
            Some(produced_at_ms) if inherited => age_since(produced_at_ms),
            _ => age_since(seen_at),
        }
    }

    /// Drops observations that only cover records below `next`, which the
    /// application has received.
    fn forget_through(&mut self, next: i64) {
        while self.seen.front().is_some_and(|&(high, _)| high <= next) {
            self.seen.pop_front();
        }
    }

    /// Halves the history, keeping the oldest observation exact.
    fn thin(&mut self) {
        let mut observations = std::mem::take(&mut self.seen).into_iter();
        let mut thinned = VecDeque::with_capacity(HISTORY_LIMIT / 2 + 2);
        thinned.extend(observations.next());
        while let Some((high, seen_at)) = observations.next() {
            let merged = observations
                .next()
                .map_or(high, |(later_high, _)| later_high);
            thinned.push_back((merged, seen_at));
        }
        self.seen = thinned;
    }
}
