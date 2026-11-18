//! Freshness and loss metrics of the live search-index consumer, recorded on
//! the meter `macro_entrypoint` installs (exported every 60 s). Tags are closed
//! sets (entity type, wire event type, outcome, topic, partition), never ids.
//!
//! - [`LAG`]: how long after its record's Kafka timestamp (set when it was
//!   published) an event's processing ended, by `entity_type`, `event_type`
//!   and `outcome`. Only events that were processed appear here; freshness
//!   reads `outcome:indexed`.
//! - [`OLDEST_PENDING`]: per assigned `topic` and `partition`, the age of the
//!   oldest record not yet processed, 0 when caught up ([`super::backlog`]).
//!   It keeps rising while the consumer is stalled, when [`LAG`] goes silent.
//! - [`DROPPED`]: events committed without reaching the index, by
//!   `entity_type`, and `event_type` for those dropped after their processing
//!   retries or `failure` (a [`Loss`]) for those that never finished.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};

use opentelemetry::{
    KeyValue,
    metrics::{Counter, Histogram, Meter, ObservableGauge},
};

use super::{EventOutcome, ReceivedEvent, entity_type::EntityType, offsets::RecordPosition};

#[cfg(test)]
pub(super) mod test;

const METER_NAME: &str = "search_processing_service";
pub(super) const LAG: &str = "search.index.lag_ms";
pub(super) const OLDEST_PENDING: &str = "search.index.oldest_pending_ms";
pub(super) const DROPPED: &str = "search.index.dropped_events";

const ENTITY_TYPE: &str = "entity_type";
const EVENT_TYPE: &str = "event_type";
const OUTCOME: &str = "outcome";
const FAILURE: &str = "failure";
const TOPIC: &str = "topic";
const PARTITION: &str = "partition";

/// Why a record was committed without reaching the index other than by
/// running out of processing retries: the `failure` tag of [`DROPPED`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum Loss {
    /// The record did not decode, so never reached a worker.
    Undecodable,
    /// A worker had started it when the consumer stopped, and no partition
    /// rewind redelivers it.
    CutOffAtStop,
    /// Queued when the consumer stopped, on a partition it no longer owned.
    NotRewound,
    /// Queued when the consumer stopped, and committing its partition back
    /// failed.
    RewindUnconfirmed,
    /// Queued when the consumer stopped after an error.
    QueuedAtErrorExit,
}

/// [`LAG`] bucket bounds in ms: dense around the 60 s and 5 min targets, then
/// out to the email topic's 10-day retention.
const LAG_BOUNDARIES_MS: [f64; 27] = [
    100.0,
    250.0,
    500.0,
    1_000.0,
    2_000.0,
    5_000.0,
    10_000.0,
    15_000.0,
    20_000.0,
    30_000.0,
    45_000.0,
    60_000.0,
    90_000.0,
    120_000.0,
    180_000.0,
    300_000.0,
    600_000.0,
    900_000.0,
    1_800_000.0,
    3_600_000.0,
    7_200_000.0,
    21_600_000.0,
    43_200_000.0,
    86_400_000.0,
    259_200_000.0,
    604_800_000.0,
    864_000_000.0,
];

/// A partition's pending age not refreshed for this long is no longer
/// reported, so a sampler that stopped shows as missing data rather than as
/// its last reading.
const PENDING_STALE_AFTER: Duration = Duration::from_secs(30);

/// The consumer's instruments. Build one per process: each registers the
/// [`OLDEST_PENDING`] callback.
#[derive(Clone)]
pub(crate) struct IndexMetrics {
    lag: Histogram<u64>,
    dropped: Counter<u64>,
    pending: PendingAges,
    _oldest_pending: ObservableGauge<u64>,
}

impl IndexMetrics {
    /// Instruments on the global meter provider.
    pub(crate) fn global() -> Self {
        Self::new(&opentelemetry::global::meter(METER_NAME))
    }

    pub(super) fn new(meter: &Meter) -> Self {
        let pending = PendingAges::default();
        let observed = pending.clone();
        Self {
            lag: meter
                .u64_histogram(LAG)
                .with_unit("ms")
                .with_description(
                    "Time from the broker recording an event to the end of its processing",
                )
                .with_boundaries(LAG_BOUNDARIES_MS.to_vec())
                .build(),
            dropped: meter
                .u64_counter(DROPPED)
                .with_description("Events committed without reaching the search index")
                .build(),
            _oldest_pending: meter
                .u64_observable_gauge(OLDEST_PENDING)
                .with_unit("ms")
                .with_description(
                    "Age of each assigned partition's oldest unprocessed record, 0 when caught up",
                )
                .with_callback(move |observer| {
                    for (topic, partition, age_ms) in observed.fresh(Instant::now()) {
                        let mut tags = vec![
                            KeyValue::new(TOPIC, topic),
                            KeyValue::new(PARTITION, i64::from(partition)),
                        ];
                        if let Some(entity_type) = EntityType::from_topic(topic) {
                            tags.push(KeyValue::new(ENTITY_TYPE, entity_type.as_str()));
                        }
                        observer.observe(age_ms, &tags);
                    }
                })
                .build(),
            pending,
        }
    }

    /// Records the end of one event's processing, or of its handoff when it
    /// needed no worker.
    pub(super) fn record_processed(&self, received: &ReceivedEvent, outcome: EventOutcome) {
        let entity_type = KeyValue::new(ENTITY_TYPE, EntityType::of(&received.event).as_str());
        let event_type = KeyValue::new(EVENT_TYPE, received.event_type);
        if let Some(produced_at_ms) = received.produced_at_ms {
            let lag_ms = chrono::Utc::now().timestamp_millis() - produced_at_ms;
            self.lag.record(
                u64::try_from(lag_ms).unwrap_or(0),
                &[
                    entity_type.clone(),
                    event_type.clone(),
                    KeyValue::new(OUTCOME, <&'static str>::from(outcome)),
                ],
            );
        }
        if outcome == EventOutcome::Dropped {
            self.dropped.add(1, &[entity_type, event_type]);
        }
    }

    /// Counts a record on `topic` lost as `loss`.
    pub(super) fn record_loss(&self, topic: &str, loss: Loss) {
        let mut tags = vec![KeyValue::new(FAILURE, <&'static str>::from(loss))];
        if let Some(entity_type) = EntityType::from_topic(topic) {
            tags.push(KeyValue::new(ENTITY_TYPE, entity_type.as_str()));
        }
        self.dropped.add(1, &tags);
    }

    pub(super) fn record_losses(&self, records: &[RecordPosition], loss: Loss) {
        for record in records {
            self.record_loss(record.topic, loss);
        }
    }

    pub(super) fn pending_ages(&self) -> &PendingAges {
        &self.pending
    }
}

/// The latest [`OLDEST_PENDING`] reading of each partition a sampler owns.
#[derive(Clone, Default)]
pub(super) struct PendingAges(Arc<Mutex<HashMap<(&'static str, i32), PendingAge>>>);

#[derive(Debug, Clone, Copy)]
struct PendingAge {
    age_ms: u64,
    sampled_at: Instant,
}

impl PendingAges {
    pub(super) fn set(
        &self,
        topic: &'static str,
        partition: i32,
        age_ms: u64,
        sampled_at: Instant,
    ) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert((topic, partition), PendingAge { age_ms, sampled_at });
    }

    pub(super) fn remove(&self, topic: &'static str, partition: i32) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&(topic, partition));
    }

    /// Readings refreshed within [`PENDING_STALE_AFTER`] of `now`, as
    /// `(topic, partition, age_ms)`; older ones are forgotten.
    pub(super) fn fresh(&self, now: Instant) -> Vec<(&'static str, i32, u64)> {
        let mut ages = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        ages.retain(|_, age| now.saturating_duration_since(age.sampled_at) < PENDING_STALE_AFTER);
        let mut fresh: Vec<_> = ages
            .iter()
            .map(|(&(topic, partition), age)| (topic, partition, age.age_ms))
            .collect();
        fresh.sort_unstable();
        fresh
    }
}
