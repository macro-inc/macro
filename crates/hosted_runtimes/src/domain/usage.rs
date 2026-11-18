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
    /// Share of its CPUs in use, 0 to 100.
    pub cpu_percent: f64,
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
    /// highest memory of each step, absent where the computer did not run.
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

/// The graph of `computer_id` at `now` from its readings, oldest first.
pub fn history(
    computer_id: ComputerId,
    vcpus: u32,
    samples: &[StoredSample],
    now: DateTime<Utc>,
) -> ComputerUsage {
    let start = now - WINDOW;
    // Per bucket: the sum and count of CPU readings, and the highest memory.
    let mut buckets = vec![(0.0_f64, 0_u32, 0_u64); BUCKETS];
    let mut latest = None;

    for pair in samples.windows(2) {
        let [earlier, later] = pair else { continue };
        let Some(cpu_percent) = cpu_percent(earlier, later, vcpus) else {
            continue;
        };
        let since_start = later.sampled_at - start;
        if since_start < Duration::zero() || later.sampled_at > now {
            continue;
        }
        let index = (since_start.num_seconds() / BUCKET.num_seconds()) as usize;
        if let Some(bucket) = buckets.get_mut(index.min(BUCKETS - 1)) {
            bucket.0 += cpu_percent;
            bucket.1 += 1;
            bucket.2 = bucket.2.max(later.memory_bytes);
        }
        if now - later.sampled_at <= LATEST_MAX_AGE {
            latest = Some(UsagePoint {
                cpu_percent,
                memory_bytes: later.memory_bytes,
            });
        }
    }

    let points = buckets
        .into_iter()
        .map(|(cpu_sum, readings, memory_bytes)| {
            (readings > 0).then(|| UsagePoint {
                cpu_percent: cpu_sum / f64::from(readings),
                memory_bytes,
            })
        })
        .collect();
    ComputerUsage {
        computer_id,
        latest,
        points,
    }
}
