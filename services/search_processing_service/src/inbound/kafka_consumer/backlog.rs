//! The age of each assigned partition's oldest unprocessed record, sampled
//! every [`SAMPLE_INTERVAL`] into
//! [`OLDEST_PENDING`](super::metrics::OLDEST_PENDING).
//!
//! A partition's next unprocessed record is either one the consumer took and
//! has not finished, which the [`OffsetLedger`] holds with its broker
//! timestamp, or the first one the application has not received: in
//! librdkafka's prefetch queue or still on the broker. That one has no
//! timestamp until it is received, so its age counts from the first sample
//! whose cached high watermark was past it, when it already existed: at most
//! one interval low. Until the application receives a record from a partition
//! after its assignment, the partition counts as caught up at its first sample.
//!
//! The position and cached watermarks are the client's own state, kept by its
//! fetcher, so samples taken while the poll loop waits on a full worker
//! channel still show records piling up.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::{Duration, Instant},
};

use rdkafka::Offset;
use rootcause::Report;

#[cfg(test)]
mod test;

use super::{
    SearchProcessingKafkaConsumer,
    metrics::PendingAges,
    offsets::{OffsetLedger, OldestOpen},
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

    pub(super) fn sample_consumer(
        &mut self,
        consumer: &SearchProcessingKafkaConsumer,
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

fn read_partitions(
    consumer: &SearchProcessingKafkaConsumer,
) -> Result<Vec<PartitionReading>, Report> {
    let consumer = consumer.inner();
    // The position list is the assignment, with each partition's position.
    let positions = consumer.position()?;
    Ok(positions
        .elements()
        .into_iter()
        .filter_map(|element| {
            let topic = subscribed_topic(element.topic())?;
            let partition = element.partition();
            let high_watermark = consumer
                .cached_watermarks(topic, partition)
                .ok()
                .map(|(_, high)| high)
                .filter(|high| *high >= 0);
            Some(PartitionReading {
                topic,
                partition,
                position: match element.offset() {
                    Offset::Offset(offset) => Some(offset),
                    _ => None,
                },
                high_watermark,
            })
        })
        .collect())
}

#[derive(Debug, Default)]
struct WatermarkHistory {
    /// `(high watermark, unix ms)` pairs, both increasing: every record below
    /// the watermark existed by that time.
    seen: VecDeque<(i64, i64)>,
    /// The watermark at the partition's first sample, its position until the
    /// application receives a record from it.
    first_high_watermark: Option<i64>,
}

impl WatermarkHistory {
    fn pending_age(
        &mut self,
        now_ms: i64,
        reading: &PartitionReading,
        oldest_open: Option<OldestOpen>,
    ) -> u64 {
        if let Some(high) = reading.high_watermark {
            self.first_high_watermark.get_or_insert(high);
            if self.seen.back().is_none_or(|&(last, _)| high > last) {
                self.seen.push_back((high, now_ms));
                if self.seen.len() > HISTORY_LIMIT {
                    self.thin();
                }
            }
        }
        let next = match oldest_open {
            Some(open) => Some(open.offset),
            None => reading.position.or(self.first_high_watermark),
        };
        let Some(next) = next else {
            return 0;
        };
        while self.seen.front().is_some_and(|&(high, _)| high <= next) {
            self.seen.pop_front();
        }
        let since_ms = oldest_open
            .and_then(|open| open.produced_at_ms)
            .or_else(|| self.seen.front().map(|&(_, seen_at)| seen_at));
        since_ms.map_or(0, |since_ms| u64::try_from(now_ms - since_ms).unwrap_or(0))
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
