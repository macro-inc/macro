//! Records the consumer has taken but not finished. Offsets are committed at
//! handoff while the consumer runs; when it stops gracefully, it commits each
//! partition it still owns back to its first record that no worker started,
//! so the partition's next owner redelivers what was still queued. A record a
//! worker had started is never rewound to: if it hangs or kills its worker,
//! redelivering it on every stop would repeat that forever. Workers finish
//! records out of partition order, since a partition's records spread across
//! workers by ordering key.

use std::collections::{BTreeMap, HashMap, btree_map::Entry, hash_map};

#[cfg(test)]
mod test;

/// A Kafka record's coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct RecordPosition {
    pub(super) topic: &'static str,
    pub(super) partition: i32,
    pub(super) offset: i64,
}

impl std::fmt::Display for RecordPosition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}@{}", self.topic, self.partition, self.offset)
    }
}

/// What a worker reports about a record it took from its channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WorkerReport {
    Started(RecordPosition),
    Done(RecordPosition),
}

/// Open deliveries of one record, and how many of them a worker started.
#[derive(Debug, Default, Clone, Copy)]
struct OpenRecord {
    deliveries: u32,
    started: u32,
    /// The record's Kafka timestamp, in Unix milliseconds, if it has one.
    produced_at_ms: Option<i64>,
}

/// A record's offset and Kafka timestamp.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct RecordTime {
    pub(super) offset: i64,
    pub(super) produced_at_ms: Option<i64>,
}

/// Unfinished records per partition. A partition leaves the ledger once its
/// last open record finishes, so it never holds state for partitions this
/// consumer has lost, apart from the newest record it received on each.
#[derive(Debug, Default)]
pub(super) struct OffsetLedger {
    /// A rebalance can deliver a record again while the first delivery is
    /// still open, so each offset counts its deliveries.
    open: HashMap<(&'static str, i32), BTreeMap<i64, OpenRecord>>,
    newest_received: HashMap<(&'static str, i32), RecordTime>,
}

impl OffsetLedger {
    /// Marks a record taken; it stays open until a worker finishes it or its
    /// handoff skips it.
    pub(super) fn received(&mut self, position: RecordPosition, produced_at_ms: Option<i64>) {
        let record = self
            .open
            .entry((position.topic, position.partition))
            .or_default()
            .entry(position.offset)
            .or_default();
        record.deliveries += 1;
        record.produced_at_ms = record.produced_at_ms.or(produced_at_ms);
        self.newest_received.insert(
            (position.topic, position.partition),
            RecordTime {
                offset: position.offset,
                produced_at_ms,
            },
        );
    }

    /// Applies a worker's report.
    pub(super) fn report(&mut self, report: WorkerReport) {
        match report {
            WorkerReport::Started(position) => self.started(position),
            WorkerReport::Done(position) => self.finished(position),
        }
    }

    /// Marks one delivery of a record started by a worker.
    pub(super) fn started(&mut self, position: RecordPosition) {
        if let Some(record) = self
            .open
            .get_mut(&(position.topic, position.partition))
            .and_then(|open| open.get_mut(&position.offset))
        {
            record.started = (record.started + 1).min(record.deliveries);
        }
    }

    /// Marks a delivery a worker started as finished, whatever its outcome.
    pub(super) fn finished(&mut self, position: RecordPosition) {
        self.close(position, |record| {
            record.started = record.started.saturating_sub(1);
        });
    }

    /// Marks a delivery finished at handoff, without a worker: coalesced,
    /// irrelevant to the index, or malformed.
    pub(super) fn skipped(&mut self, position: RecordPosition) {
        self.close(position, |_| {});
    }

    fn close(&mut self, position: RecordPosition, release: impl FnOnce(&mut OpenRecord)) {
        let hash_map::Entry::Occupied(mut partition) =
            self.open.entry((position.topic, position.partition))
        else {
            return;
        };
        if let Entry::Occupied(mut open) = partition.get_mut().entry(position.offset) {
            let record = open.get_mut();
            release(record);
            record.deliveries = record.deliveries.saturating_sub(1);
            record.started = record.started.min(record.deliveries);
            if record.deliveries == 0 {
                open.remove();
            }
        }
        if partition.get().is_empty() {
            partition.remove();
        }
    }

    /// For each partition `assigned` accepts, the offset of its first record
    /// no worker has started: where its next owner must start. An offset with
    /// any started delivery is never a target, even when a second delivery of
    /// it is queued, since Kafka cannot replay one delivery without the other.
    /// Started records at later offsets are still replayed from the target.
    pub(super) fn rewind_points(
        &self,
        assigned: impl Fn(&str, i32) -> bool,
    ) -> Vec<RecordPosition> {
        let mut points: Vec<RecordPosition> = self
            .open
            .iter()
            .filter(|((topic, partition), _)| assigned(topic, *partition))
            .filter_map(|(&(topic, partition), open)| {
                open.iter()
                    .find(|(_, record)| record.started == 0)
                    .map(|(&offset, _)| RecordPosition {
                        topic,
                        partition,
                        offset,
                    })
            })
            .collect();
        points.sort_by_key(|point| (point.topic, point.partition));
        points
    }

    /// The partition's lowest record not finished yet, started or not.
    pub(super) fn oldest_open(&self, topic: &'static str, partition: i32) -> Option<RecordTime> {
        let (&offset, record) = self.open.get(&(topic, partition))?.first_key_value()?;
        Some(RecordTime {
            offset,
            produced_at_ms: record.produced_at_ms,
        })
    }

    /// The partition's most recently received record, finished or not.
    pub(super) fn newest_received(
        &self,
        topic: &'static str,
        partition: i32,
    ) -> Option<RecordTime> {
        self.newest_received.get(&(topic, partition)).copied()
    }

    /// Records a worker started and did not finish: a stop does not
    /// redeliver them.
    pub(super) fn started_unfinished(&self) -> Vec<RecordPosition> {
        self.positions(|record| record.started > 0)
    }

    /// Records no worker has started.
    pub(super) fn queued(&self) -> Vec<RecordPosition> {
        self.positions(|record| record.started == 0)
    }

    fn positions(&self, keep: impl Fn(&OpenRecord) -> bool) -> Vec<RecordPosition> {
        let mut positions: Vec<RecordPosition> = self
            .open
            .iter()
            .flat_map(|(&(topic, partition), open)| {
                open.iter()
                    .filter(|(_, record)| keep(record))
                    .map(move |(&offset, _)| RecordPosition {
                        topic,
                        partition,
                        offset,
                    })
            })
            .collect();
        positions.sort_by_key(|position| (position.topic, position.partition, position.offset));
        positions
    }
}
