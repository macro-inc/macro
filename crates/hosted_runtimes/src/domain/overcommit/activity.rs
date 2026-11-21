//! Since when each awake guest has been idle, from its CPU time across passes.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use super::GuestMemory;
use crate::domain::ids::ComputerId;

/// A guest's CPU share of one vCPU, between two readings, under which it
/// counts as idle: an idle macro-box spends ~1-3% of a vCPU on timers.
pub const IDLE_CPU_SHARE: f64 = 0.1;

/// One reading of an awake guest's activity, each overcommit pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivitySample {
    /// The computer the guest runs.
    pub computer_id: ComputerId,
    /// CPU time the guest's process has used since it started.
    pub cpu_usage_microseconds: u64,
    /// Memory only this guest holds, in MiB.
    pub private_memory_mib: u64,
}

#[derive(Debug, Clone, Copy)]
struct Seen {
    cpu_usage_microseconds: u64,
    at: DateTime<Utc>,
    idle_since: Option<DateTime<Utc>>,
}

/// Since when each awake guest has been idle, from CPU readings across
/// passes: a guest is idle while it spent under [`IDLE_CPU_SHARE`] of a vCPU
/// between two readings. Whether someone uses it (a live agent session) is
/// asked separately, and only under pressure. A guest seen once, or whose counter went back (a new
/// process), counts as busy until the next reading: idleness is never
/// assumed, so a restarted operator hibernates nothing for
/// [`LiveMemoryLimits::minimum_idle`].
#[derive(Debug, Default)]
pub struct ActivityTracker {
    guests: HashMap<ComputerId, Seen>,
}

impl ActivityTracker {
    /// Fold one pass of readings for a host's awake guests and return what
    /// relief sees of them. Guests missing from `samples` (hibernated,
    /// stopped, gone) are forgotten.
    pub fn observe(&mut self, samples: &[ActivitySample], now: DateTime<Utc>) -> Vec<GuestMemory> {
        let present: HashSet<ComputerId> =
            samples.iter().map(|sample| sample.computer_id).collect();
        self.guests.retain(|id, _| present.contains(id));
        samples
            .iter()
            .map(|sample| {
                let previous = self.guests.get(&sample.computer_id).copied();
                let quiet =
                    previous.is_some_and(|seen| is_quiet(seen, sample.cpu_usage_microseconds, now));
                let idle_since = if quiet {
                    // Quiet since the previous reading, which `quiet` implies.
                    previous.and_then(|seen| seen.idle_since.or(Some(seen.at)))
                } else {
                    None
                };
                self.guests.insert(
                    sample.computer_id,
                    Seen {
                        cpu_usage_microseconds: sample.cpu_usage_microseconds,
                        at: now,
                        idle_since,
                    },
                );
                GuestMemory {
                    computer_id: sample.computer_id,
                    resident_memory_mib: sample.private_memory_mib,
                    idle_since,
                }
            })
            .collect()
    }

    /// Forget a guest, e.g. once it was hibernated or woken.
    pub fn forget(&mut self, computer_id: ComputerId) {
        self.guests.remove(&computer_id);
    }
}

fn is_quiet(seen: Seen, cpu_usage_microseconds: u64, now: DateTime<Utc>) -> bool {
    let Some(used) = cpu_usage_microseconds.checked_sub(seen.cpu_usage_microseconds) else {
        return false;
    };
    let Some(elapsed) = (now - seen.at)
        .num_microseconds()
        .filter(|elapsed| *elapsed > 0)
    else {
        return false;
    };
    (used as f64) < IDLE_CPU_SHARE * elapsed as f64
}
