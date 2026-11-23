//! Whether a start or a wake fits a host now.

use chrono::{DateTime, Utc};

use super::{HostCapacity, MemoryReport};
use crate::domain::size::ComputerResources;

/// What a host's awake, unhibernated computers hold: their recorded vCPUs
/// and memory.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AwakeAllocation {
    /// vCPUs of the awake computers.
    pub vcpus: u64,
    /// Memory of the awake computers, in GiB.
    pub memory_gib: u64,
}

impl AwakeAllocation {
    /// The allocation with `resources` added.
    pub fn with(self, resources: ComputerResources) -> Self {
        Self {
            vcpus: self.vcpus + u64::from(resources.vcpus.get()),
            memory_gib: self.memory_gib + u64::from(resources.memory_gib.get()),
        }
    }
}

/// Why a start or wake was not admitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Refusal {
    /// The host has not reported its hardware; nothing is admitted blind.
    UnknownHardware,
    /// The awake computers' vCPUs would exceed the allocation ratio.
    CpuAllocation,
    /// The awake computers' memory would exceed the allocation ratio.
    MemoryAllocation,
    /// The host has not reported its memory recently; nothing is admitted blind.
    StaleMemoryReport,
    /// Resident memory is at or above the high watermark.
    HighWatermark,
    /// The start would take resident memory over the hard ceiling.
    HardCeiling,
}

/// Whether a hibernated computer may wake now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeAdmission {
    /// It counts against its host again; restore it.
    Admitted,
    /// The host has no room; it stays hibernated.
    Refused(Refusal),
    /// It is not hibernated; nothing to wake.
    NotHibernated,
}

/// Whether a computer of `candidate` may start on the host now, beside the
/// `awake` computers already there. `report` is the host's latest memory
/// report, with the starts admitted since it counted in
/// ([`MemoryReport::with_pending_starts`]); nothing is admitted without a
/// fresh one.
pub fn admit(
    capacity: &HostCapacity,
    awake: AwakeAllocation,
    candidate: ComputerResources,
    report: Option<MemoryReport>,
    now: DateTime<Utc>,
) -> Result<(), Refusal> {
    let after = awake.with(candidate);
    if after.vcpus > capacity.allocatable_vcpus() {
        return Err(Refusal::CpuAllocation);
    }
    if after.memory_gib > capacity.allocatable_memory_gib() {
        return Err(Refusal::MemoryAllocation);
    }
    let limits = capacity.policy.live_memory;
    let report = report
        .filter(|report| now - report.reported_at <= limits.report_freshness())
        .ok_or(Refusal::StaleMemoryReport)?;
    if capacity.under_pressure(report) {
        return Err(Refusal::HighWatermark);
    }
    let projected = report
        .resident_memory_mib
        .saturating_add(limits.start_resident_memory_mib());
    if projected > capacity.memory_threshold_mib(limits.hard_ceiling()) {
        return Err(Refusal::HardCeiling);
    }
    Ok(())
}
