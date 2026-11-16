//! Timing of population attempts: settling, leases, retries, parking and pauses.

use std::time::Duration;

/// How long a new request waits before its first attempt. Requests of one
/// import arrive together, and some are recorded just before their message
/// commits, so the attempt runs once they have settled.
pub const SETTLE: Duration = Duration::from_secs(10);
/// Longest a stream of further requests may keep postponing a pending
/// request's attempt.
pub const MAX_POSTPONE: Duration = Duration::from_secs(120);
/// How long an attempt holds its request before another worker may take it.
pub const LEASE: Duration = Duration::from_secs(600);
/// Longest one attempt may run. Shorter than [`LEASE`], so an attempt settles
/// its own request before the lease lapses.
pub const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(240);
/// Attempts in flight across every mailbox and worker process. A population
/// that changes something scans its mailbox's eligible mail, so this is the
/// number of database backends population keeps busy when every attempt scans.
/// Claims that race may exceed it by a few for one attempt; the worker lanes
/// are the hard bound.
pub const FLEET_CONCURRENCY: u8 = 4;
/// Attempts one mailbox may have in flight. Fewer than [`FLEET_CONCURRENCY`],
/// so one mailbox's backlog never takes every attempt.
pub const MAILBOX_CONCURRENCY: u8 = 2;
/// Attempts after which a request is parked instead of retried.
pub const MAX_ATTEMPTS: u8 = 8;
/// How long a parked request stays parked before a new request for the same
/// correspondent may revive it.
pub const PARK_COOLDOWN: Duration = Duration::from_secs(24 * 60 * 60);
/// Consecutive failures at which a pausing mailbox is reported as an error.
pub const ALERT_AFTER_FAILURES: u32 = 5;

const FIRST_RETRY: Duration = Duration::from_secs(60);
const MAX_RETRY: Duration = Duration::from_secs(60 * 60);
const FIRST_PAUSE: Duration = Duration::from_secs(15);
const MAX_PAUSE: Duration = Duration::from_secs(30 * 60);

/// When a request whose `attempt`th attempt failed is tried again; `None`
/// once its attempts are spent.
pub fn retry_after(attempt: u8) -> Option<Duration> {
    (attempt < MAX_ATTEMPTS).then(|| doubled(FIRST_RETRY, u32::from(attempt), MAX_RETRY))
}

/// How long a mailbox takes no work after its `failures`th consecutive failure.
pub fn pause_after(failures: u32) -> Duration {
    doubled(FIRST_PAUSE, failures, MAX_PAUSE)
}

/// `first`, doubled for each occurrence after the first, up to `max`.
fn doubled(first: Duration, occurrence: u32, max: Duration) -> Duration {
    let doublings = occurrence.saturating_sub(1).min(16);
    first.saturating_mul(1 << doublings).min(max)
}
