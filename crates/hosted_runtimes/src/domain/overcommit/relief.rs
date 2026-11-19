//! Which guests to hibernate when a host's memory is over its high watermark.

use std::collections::HashSet;

use chrono::{DateTime, Utc};

use super::{HostCapacity, MemoryReport};
use crate::domain::ids::ComputerId;

/// One awake guest, as relief sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GuestMemory {
    /// The computer the guest runs.
    pub computer_id: ComputerId,
    /// Memory only this guest holds, in MiB: what hibernating it frees.
    pub resident_memory_mib: u64,
    /// Since when the guest has been idle; `None` while it is busy.
    pub idle_since: Option<DateTime<Utc>>,
}

/// Mark the `in_use` guests busy for this pass.
pub fn mark_in_use(guests: &mut [GuestMemory], in_use: &HashSet<ComputerId>) {
    for guest in guests {
        if in_use.contains(&guest.computer_id) {
            guest.idle_since = None;
        }
    }
}

/// The guests to hibernate, idlest first, to bring resident memory from
/// `report` back under the low watermark; nothing while the host is under
/// its high watermark. Busy guests and guests idle for less than
/// [`super::LiveMemoryLimits::minimum_idle`] are never picked, so the list
/// can stop short of the target; the host then keeps refusing starts.
pub fn relieve(
    capacity: &HostCapacity,
    report: MemoryReport,
    guests: &[GuestMemory],
    now: DateTime<Utc>,
) -> Vec<ComputerId> {
    if !capacity.under_pressure(report) {
        return Vec::new();
    }
    let limits = capacity.policy.live_memory;
    let target = capacity.memory_threshold_mib(limits.low_watermark());
    let mut idle: Vec<(DateTime<Utc>, &GuestMemory)> = guests
        .iter()
        .filter_map(|guest| guest.idle_since.map(|since| (since, guest)))
        .filter(|(since, _)| now - *since >= limits.minimum_idle())
        .collect();
    // Longest idle first; equal idleness frees the bigger guest first.
    idle.sort_by(|(left_since, left), (right_since, right)| {
        left_since
            .cmp(right_since)
            .then(right.resident_memory_mib.cmp(&left.resident_memory_mib))
    });
    let mut resident = report.resident_memory_mib;
    let mut picked = Vec::new();
    for (_, guest) in idle {
        if resident < target {
            break;
        }
        resident = resident.saturating_sub(guest.resident_memory_mib);
        picked.push(guest.computer_id);
    }
    picked
}
