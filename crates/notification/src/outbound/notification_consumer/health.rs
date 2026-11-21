//! Per-process telemetry for the deliberately ungrouped notification consumer.
//! A separate timer reports stale callbacks even if application consumption stalls.

use std::{sync::Arc, time::Duration};

use chrono::Utc;
use kafka_util::{
    ConsumerStatistics,
    progress::{STALE_AFTER, assigned_partitions},
};
use rdkafka::statistics::Statistics;
use tokio::{
    sync::watch,
    time::{Instant, MissedTickBehavior},
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

const TOPIC: &str = "macro.notifications";
const REPORT_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Backlog {
    known_partitions: u32,
    unknown_partitions: u32,
    max_offset_backlog: u64,
    total_offset_backlog: u64,
    prefetched_messages: u64,
    connected_brokers: usize,
    disconnected_partitions: u32,
}

fn backlog(stats: &Statistics) -> Option<Backlog> {
    if !stats.topics.contains_key(TOPIC) {
        return None;
    }
    let mut result = Backlog {
        connected_brokers: stats
            .brokers
            .values()
            .filter(|b| b.nodeid >= 0 && b.state == "UP")
            .count(),
        ..Backlog::default()
    };
    for partition in assigned_partitions(stats)
        .into_iter()
        .filter(|partition| partition.topic == TOPIC)
    {
        if !partition.broker_up {
            result.disconnected_partitions += 1;
        }
        if let Some(pending) = partition.pending {
            result.known_partitions += 1;
            result.max_offset_backlog = result.max_offset_backlog.max(pending);
            result.total_offset_backlog = result.total_offset_backlog.saturating_add(pending);
        } else {
            result.unknown_partitions += 1;
        }
        if let Some(queued) = partition.prefetched {
            result.prefetched_messages = result.prefetched_messages.saturating_add(queued);
        }
    }
    Some(result)
}

#[derive(Clone, Copy)]
struct Observation {
    received_at: Instant,
    sampled_at: i64,
    backlog: Option<Backlog>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum Health {
    Starting,
    Healthy,
    Unavailable,
    Disconnected,
    Stale,
}

fn health(
    observation: Option<Observation>,
    started_at: Instant,
    now: Instant,
    unix_now: i64,
) -> Health {
    let starting = now.duration_since(started_at) < STALE_AFTER;
    let Some(observation) = observation else {
        return if starting {
            Health::Starting
        } else {
            Health::Unavailable
        };
    };
    // librdkafka queues callbacks while recv is stalled. A newly delivered but
    // old sample is stale too; callback arrival time alone would hide that stall.
    if now.duration_since(observation.received_at) >= STALE_AFTER
        || unix_now
            .saturating_sub(observation.sampled_at)
            .unsigned_abs()
            >= STALE_AFTER.as_secs()
    {
        return Health::Stale;
    }
    let Some(backlog) = observation.backlog else {
        return if starting {
            Health::Starting
        } else {
            Health::Unavailable
        };
    };
    if backlog.connected_brokers == 0 || backlog.disconnected_partitions > 0 {
        return if starting {
            Health::Starting
        } else {
            Health::Disconnected
        };
    }
    if backlog.known_partitions == 0 || backlog.unknown_partitions > 0 {
        return if starting {
            Health::Starting
        } else {
            Health::Unavailable
        };
    }
    Health::Healthy
}

/// Owns the reporter's lifetime; dropping a consumer also stops its telemetry.
pub(super) struct ConsumerHealth {
    cancellation: CancellationToken,
    tasks: TaskTracker,
}

impl Drop for ConsumerHealth {
    fn drop(&mut self) {
        self.cancellation.cancel();
        self.tasks.close();
    }
}

impl ConsumerHealth {
    pub(super) fn start() -> (ConsumerStatistics, Self) {
        let (observed, state) = watch::channel(None);
        let observer: ConsumerStatistics = Arc::new(move |stats| {
            observed.send_replace(Some(Observation {
                received_at: Instant::now(),
                sampled_at: stats.time,
                backlog: backlog(stats),
            }));
        });
        let consumer_instance = Uuid::now_v7();
        let started_at = Instant::now();
        let cancellation = CancellationToken::new();
        let stop = cancellation.clone();
        let tasks = TaskTracker::new();
        tasks.spawn(async move {
            let mut interval = tokio::time::interval(REPORT_INTERVAL);
            interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _ = stop.cancelled() => break,
                    _ = interval.tick() => {}
                }
                let observation = *state.borrow();
                let status = health(
                    observation,
                    started_at,
                    Instant::now(),
                    Utc::now().timestamp(),
                );
                let snapshot = observation.and_then(|o| o.backlog);
                // Never advertise a stale/partial observation as a zero backlog.
                let known = snapshot.filter(|_| status == Health::Healthy);
                tracing::info!(
                    telemetry_event = "notification_consumer_health",
                    %consumer_instance,
                    topic = TOPIC,
                    consumer_health = status.as_ref(),
                    known_partitions = snapshot.map(|s| s.known_partitions),
                    unknown_partitions = snapshot.map(|s| s.unknown_partitions),
                    disconnected_partitions = snapshot.map(|s| s.disconnected_partitions),
                    max_offset_backlog = known.map(|s| s.max_offset_backlog),
                    total_offset_backlog = known.map(|s| s.total_offset_backlog),
                    prefetched_messages = known.map(|s| s.prefetched_messages),
                    "notification consumer health"
                );
            }
        });
        (
            observer,
            Self {
                cancellation,
                tasks,
            },
        )
    }
}

#[cfg(test)]
mod test;
