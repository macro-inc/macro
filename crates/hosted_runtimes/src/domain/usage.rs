//! Each computer's CPU and memory over the last day, as its team sees it in
//! Settings: the overcommit pass keeps one host reading per computer per
//! minute ([`UsageSample`]); [`history`] turns a computer's readings into the
//! [`BUCKETS`] points of the graph and the latest value.
//!
//! Readings keep the cgroup's CPU counter as read. CPU use is the counter's
//! growth between two readings, so a point is the true average over that
//! time and any control-plane replica may write a minute's reading.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::domain::ids::ComputerId;

#[cfg(test)]
mod test;

/// How far back readings are shown.
pub const WINDOW: Duration = Duration::hours(24);
/// How long one point of the graph covers.
pub const BUCKET: Duration = Duration::minutes(15);
/// Points in the graph: [`WINDOW`] in [`BUCKET`]s.
pub const BUCKETS: usize = 96;
/// How long readings are kept: the window and an hour to spare.
pub const RETENTION: Duration = Duration::hours(25);
/// A reading older than this is no longer "now": the computer is idle
/// (hibernated) or off.
pub const LATEST_MAX_AGE: Duration = Duration::minutes(3);
/// Two readings further apart than this have a time between them when the
/// computer did not run; no CPU use is measured across it.
const MAX_GAP: Duration = Duration::minutes(5);

/// The minute `at` falls in: a computer keeps one reading per minute.
pub fn minute_of(at: DateTime<Utc>) -> DateTime<Utc> {
    at - Duration::seconds(at.timestamp().rem_euclid(60))
        - Duration::nanoseconds(i64::from(at.timestamp_subsec_nanos()))
}

/// One reading of a running computer, as its host measured it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsageSample {
    /// The computer.
    pub computer_id: ComputerId,
    /// CPU time its process used since it started.
    pub cpu_usage_microseconds: u64,
    /// Memory only it holds: pages it wrote, in RAM or swapped out. Memory
    /// it still shares with its image is not counted.
    pub memory_bytes: u64,
}

/// A stored reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoredSample {
    /// When the host measured it.
    pub sampled_at: DateTime<Utc>,
    /// CPU time the process had used.
    pub cpu_usage_microseconds: u64,
    /// Memory only the computer held.
    pub memory_bytes: u64,
}

/// A computer's use at one point of the graph.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UsagePoint {
    /// Share of its CPUs in use, 0 to 100. Absent until a second reading
    /// of the same run measures it: a computer's first reading after it
    /// starts or wakes has memory only.
    pub cpu_percent: Option<f64>,
    /// Memory only it holds, in bytes; memory shared with its image is not
    /// counted.
    pub memory_bytes: u64,
}

/// A computer's CPU and memory over the last day.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ComputerUsage {
    /// The computer.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub computer_id: ComputerId,
    /// Its use now; absent when it has no reading from the last few minutes
    /// (off, or idle and put to sleep).
    pub latest: Option<UsagePoint>,
    /// The last 24 hours in 15-minute steps, oldest first: average CPU and
    /// highest memory of each step, absent where the computer has no
    /// reading (it did not run).
    pub points: Vec<Option<UsagePoint>>,
}

/// CPU use between two readings as a share of `vcpus`, 0 to 100. `None`
/// when the counter went back (a new process) or the readings are too far
/// apart to be one run.
fn cpu_percent(earlier: &StoredSample, later: &StoredSample, vcpus: u32) -> Option<f64> {
    let elapsed = later.sampled_at - earlier.sampled_at;
    if elapsed <= Duration::zero() || elapsed > MAX_GAP {
        return None;
    }
    let used = later
        .cpu_usage_microseconds
        .checked_sub(earlier.cpu_usage_microseconds)?;
    let elapsed_microseconds = elapsed.num_microseconds()? as f64;
    let percent = used as f64 / elapsed_microseconds / f64::from(vcpus.max(1)) * 100.0;
    Some(percent.clamp(0.0, 100.0))
}

/// One bucket of the graph while it is filled.
#[derive(Clone, Copy, Default)]
struct Bucket {
    /// Readings that fell in it.
    readings: u32,
    /// Their highest memory.
    memory_bytes: u64,
    /// The sum and count of the CPU measurements that ended in it.
    cpu_percent_sum: f64,
    cpu_measurements: u32,
}

/// The graph of `computer_id` at `now` from its readings, oldest first.
/// Memory comes from every reading; CPU from each reading and the one
/// before it, when both are of one run.
pub fn history(
    computer_id: ComputerId,
    vcpus: u32,
    samples: &[StoredSample],
    now: DateTime<Utc>,
) -> ComputerUsage {
    let start = now - WINDOW;
    let mut buckets = vec![Bucket::default(); BUCKETS];
    let mut latest = None;

    for (index, sample) in samples.iter().enumerate() {
        let since_start = sample.sampled_at - start;
        if since_start < Duration::zero() || sample.sampled_at > now {
            continue;
        }
        let cpu_percent = index
            .checked_sub(1)
            .and_then(|earlier| samples.get(earlier))
            .and_then(|earlier| cpu_percent(earlier, sample, vcpus));

        let position = (since_start.num_seconds() / BUCKET.num_seconds()) as usize;
        if let Some(bucket) = buckets.get_mut(position.min(BUCKETS - 1)) {
            bucket.readings += 1;
            bucket.memory_bytes = bucket.memory_bytes.max(sample.memory_bytes);
            if let Some(cpu_percent) = cpu_percent {
                bucket.cpu_percent_sum += cpu_percent;
                bucket.cpu_measurements += 1;
            }
        }
        if now - sample.sampled_at <= LATEST_MAX_AGE {
            latest = Some(UsagePoint {
                cpu_percent,
                memory_bytes: sample.memory_bytes,
            });
        }
    }

    let points = buckets
        .into_iter()
        .map(|bucket| {
            (bucket.readings > 0).then(|| UsagePoint {
                cpu_percent: (bucket.cpu_measurements > 0)
                    .then(|| bucket.cpu_percent_sum / f64::from(bucket.cpu_measurements)),
                memory_bytes: bucket.memory_bytes,
            })
        })
        .collect();
    ComputerUsage {
        computer_id,
        latest,
        points,
    }
}
