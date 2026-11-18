//! How much a host may run, from its hardware, its per-host overcommit
//! settings and the memory it actually uses.
//!
//! Two limits apply to every start and every wake ([`admit`]):
//! - **Allocation**: the awake, unhibernated computers' recorded vCPUs and
//!   memory fit the host's hardware, less its reserve, times its allocation
//!   ratios.
//! - **Live memory**: the host's last report is fresh, its resident memory
//!   (with the starts admitted since the report) is under the high
//!   watermark, and the start cannot push it over the hard ceiling.
//!
//! Above the high watermark the host stops admitting, and [`relieve`] picks
//! the idlest guests ([`ActivityTracker`]) to hibernate until resident memory
//! is back under the low watermark. The hard ceiling is also the limit the
//! host agent enforces on its guests' memory. Settings live on the host row,
//! so changing them needs no deploy; every function here is pure.

use chrono::{DateTime, Duration, Utc};

use crate::domain::ids::HostId;
use crate::domain::models::HostName;
use crate::domain::size::{MEMORY_GIB_PER_UNIT, VCPUS_PER_UNIT};

mod activity;
mod admission;
mod relief;
pub mod telemetry;
#[cfg(test)]
mod test;

pub use activity::{ActivitySample, ActivityTracker, IDLE_CPU_SHARE};
pub use admission::{AwakeAllocation, Refusal, WakeAdmission, admit};
pub use relief::{GuestMemory, mark_in_use, relieve};

const MIB_PER_GIB: u64 = 1024;

/// A whole percentage: `150` is a ratio of 1.5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Percent(u32);

impl Percent {
    /// Wrap a whole percentage.
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    /// The percentage.
    pub const fn get(self) -> u32 {
        self.0
    }

    /// `self` percent of `amount`, rounded down.
    fn of(self, amount: u64) -> u64 {
        amount.saturating_mul(u64::from(self.0)) / 100
    }

    /// The share as a ratio, `0.8` for 80%.
    fn ratio(self) -> f64 {
        f64::from(self.0) / 100.0
    }
}

/// A host's overcommit settings, stored on its row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OvercommitPolicy {
    /// Awake vCPUs per vCPU left after the reserve.
    pub cpu_allocation_ratio: Percent,
    /// Awake memory per GiB of host memory left after the reserve.
    pub ram_allocation_ratio: Percent,
    /// vCPUs kept for the host itself.
    pub reserved_vcpus: u32,
    /// Memory in GiB kept for the host itself.
    pub reserved_memory_gib: u32,
    /// Sold units per awake unit.
    pub oversell_factor: u32,
    /// Admission and relief on the host's resident memory.
    pub live_memory: LiveMemoryLimits,
}

/// Why an [`OvercommitPolicy`] cannot be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InvalidOvercommitPolicy {
    /// An allocation ratio of zero admits nothing.
    #[error("allocation ratios must be positive")]
    ZeroAllocationRatio,
    /// The oversell factor must be at least one.
    #[error("the oversell factor must be at least 1")]
    ZeroOversell,
    /// Watermarks must rise from low to high to the ceiling, which is at most 100%.
    #[error("memory watermarks must satisfy low < high <= ceiling <= 100")]
    WatermarkOrder,
    /// Durations must be positive.
    #[error("idle and freshness durations must be positive")]
    NonPositiveDuration,
}

impl OvercommitPolicy {
    /// Check the allocation settings; the live limits are checked when built.
    pub fn validate(self) -> Result<Self, InvalidOvercommitPolicy> {
        if self.cpu_allocation_ratio.get() == 0 || self.ram_allocation_ratio.get() == 0 {
            return Err(InvalidOvercommitPolicy::ZeroAllocationRatio);
        }
        if self.oversell_factor == 0 {
            return Err(InvalidOvercommitPolicy::ZeroOversell);
        }
        Ok(self)
    }
}

/// Limits on a host's resident memory, as shares of its total memory. Built
/// only through [`LiveMemoryLimits::new`], so the watermarks always rise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveMemoryLimits {
    low_watermark: Percent,
    high_watermark: Percent,
    hard_ceiling: Percent,
    start_resident_memory_mib: u64,
    minimum_idle: Duration,
    report_freshness: Duration,
}

/// The three memory thresholds of [`LiveMemoryLimits`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Watermarks {
    /// Relief stops once resident memory is under this.
    pub low: Percent,
    /// At or above this the host stops admitting and relief starts.
    pub high: Percent,
    /// A start may never take resident memory over this.
    pub hard_ceiling: Percent,
}

impl LiveMemoryLimits {
    /// Limits with `low < high <= hard_ceiling <= 100` and positive durations.
    pub fn new(
        watermarks: Watermarks,
        start_resident_memory_mib: u64,
        minimum_idle: Duration,
        report_freshness: Duration,
    ) -> Result<Self, InvalidOvercommitPolicy> {
        if !(watermarks.low < watermarks.high
            && watermarks.high <= watermarks.hard_ceiling
            && watermarks.hard_ceiling <= Percent::new(100))
        {
            return Err(InvalidOvercommitPolicy::WatermarkOrder);
        }
        if minimum_idle <= Duration::zero() || report_freshness <= Duration::zero() {
            return Err(InvalidOvercommitPolicy::NonPositiveDuration);
        }
        Ok(Self {
            low_watermark: watermarks.low,
            high_watermark: watermarks.high,
            hard_ceiling: watermarks.hard_ceiling,
            start_resident_memory_mib,
            minimum_idle,
            report_freshness,
        })
    }

    /// Relief stops once resident memory is under this.
    pub fn low_watermark(&self) -> Percent {
        self.low_watermark
    }

    /// At or above this the host stops admitting and relief starts.
    pub fn high_watermark(&self) -> Percent {
        self.high_watermark
    }

    /// A start may never take resident memory over this.
    pub fn hard_ceiling(&self) -> Percent {
        self.hard_ceiling
    }

    /// Resident memory a computer is expected to add when it starts, in MiB.
    pub fn start_resident_memory_mib(&self) -> u64 {
        self.start_resident_memory_mib
    }

    /// How long a guest must have been idle before relief may hibernate it.
    pub fn minimum_idle(&self) -> Duration {
        self.minimum_idle
    }

    /// How old a memory report may be and still admit starts.
    pub fn report_freshness(&self) -> Duration {
        self.report_freshness
    }
}

/// What a host has, as it reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostHardware {
    /// Logical CPUs (nested, the host VM's vCPUs).
    pub vcpus: u32,
    /// Total memory in MiB.
    pub memory_mib: u64,
}

/// The host's resident memory at one time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryReport {
    /// Memory in use on the host, guests and host together, in MiB.
    pub resident_memory_mib: u64,
    /// When the host measured it.
    pub reported_at: DateTime<Utc>,
}

impl MemoryReport {
    /// The report with the starts admitted since it was measured counted as
    /// resident already, each at [`LiveMemoryLimits::start_resident_memory_mib`]:
    /// a burst of starts between two reports is judged as a whole, never
    /// each against the same measurement.
    pub fn with_pending_starts(self, pending_starts: u32, limits: &LiveMemoryLimits) -> Self {
        Self {
            resident_memory_mib: self.resident_memory_mib.saturating_add(
                limits
                    .start_resident_memory_mib
                    .saturating_mul(u64::from(pending_starts)),
            ),
            ..self
        }
    }
}

/// A host's hardware under its policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostCapacity {
    /// What the host has.
    pub hardware: HostHardware,
    /// How far it may be overcommitted.
    pub policy: OvercommitPolicy,
}

impl HostCapacity {
    /// vCPUs awake computers may hold in total.
    pub fn allocatable_vcpus(&self) -> u64 {
        let physical = u64::from(
            self.hardware
                .vcpus
                .saturating_sub(self.policy.reserved_vcpus),
        );
        self.policy.cpu_allocation_ratio.of(physical)
    }

    /// Memory in GiB awake computers may hold in total.
    pub fn allocatable_memory_gib(&self) -> u64 {
        let physical = (self.hardware.memory_mib / MIB_PER_GIB)
            .saturating_sub(u64::from(self.policy.reserved_memory_gib));
        self.policy.ram_allocation_ratio.of(physical)
    }

    /// Units available to awake computers: the scarcer of CPU and memory.
    pub fn awake_units(&self) -> u32 {
        let by_memory = self.allocatable_memory_gib() / u64::from(MEMORY_GIB_PER_UNIT);
        let by_cpu = self.allocatable_vcpus() / u64::from(VCPUS_PER_UNIT);
        u32::try_from(by_memory.min(by_cpu)).unwrap_or(u32::MAX)
    }

    /// Units that may be sold: awake units times the oversell factor.
    pub fn sold_units(&self) -> u32 {
        self.awake_units()
            .saturating_mul(self.policy.oversell_factor)
    }

    fn memory_threshold_mib(&self, share: Percent) -> u64 {
        share.of(self.hardware.memory_mib)
    }

    /// What the host agent enforces itself: the most memory its guests may
    /// hold together (the hard ceiling, `memory.max` of the VMs' parent
    /// cgroup, the backstop behind admission and relief), the window in
    /// which it squeezes idle guests' memory into zram (low to high
    /// watermark; above it relief hibernates), and the `/home` sizes it
    /// prepares ahead of creates.
    pub fn agent_limits(&self, home_disk_gib: Vec<u32>) -> HostAgentLimits {
        let limits = self.policy.live_memory;
        HostAgentLimits {
            guest_memory_max_mib: self.memory_threshold_mib(limits.hard_ceiling),
            squeeze_above_mib: self.memory_threshold_mib(limits.low_watermark),
            squeeze_below_mib: self.memory_threshold_mib(limits.high_watermark),
            home_disk_gib,
        }
    }

    /// Resident memory and the limits as shares of host memory, for gauges;
    /// `None` for a host that reported no memory.
    pub fn memory_ratios(&self, report: MemoryReport) -> Option<MemoryRatios> {
        let total = self.hardware.memory_mib;
        if total == 0 {
            return None;
        }
        let limits = self.policy.live_memory;
        Some(MemoryRatios {
            used: report.resident_memory_mib as f64 / total as f64,
            low_watermark: limits.low_watermark.ratio(),
            high_watermark: limits.high_watermark.ratio(),
            hard_ceiling: limits.hard_ceiling.ratio(),
        })
    }

    /// Whether resident memory has reached the high watermark.
    pub fn under_pressure(&self, report: MemoryReport) -> bool {
        report.resident_memory_mib
            >= self.memory_threshold_mib(self.policy.live_memory.high_watermark)
    }
}

/// What a host agent enforces and prepares itself; memory in MiB.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostAgentLimits {
    /// The most memory its guests may hold together.
    pub guest_memory_max_mib: u64,
    /// It squeezes idle guests into zram while resident memory is above this…
    pub squeeze_above_mib: u64,
    /// …and below this.
    pub squeeze_below_mib: u64,
    /// The `/home` sizes sold, in GiB, smallest first.
    pub home_disk_gib: Vec<u32>,
}

/// A host's resident memory and limits as shares (0..=1) of its memory.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryRatios {
    /// Resident memory.
    pub used: f64,
    /// [`LiveMemoryLimits::low_watermark`].
    pub low_watermark: f64,
    /// [`LiveMemoryLimits::high_watermark`].
    pub high_watermark: f64,
    /// [`LiveMemoryLimits::hard_ceiling`].
    pub hard_ceiling: f64,
}

/// A host's overcommit settings, hardware and latest memory report, as its
/// row holds them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostOvercommit {
    /// The host.
    pub host_id: HostId,
    /// Its name, for metrics.
    pub name: HostName,
    /// Its hardware under its policy; `None` until it reported its hardware.
    pub capacity: Option<HostCapacity>,
    /// Its latest memory report; `None` until its first.
    pub report: Option<MemoryReport>,
    /// Starts and wakes admitted since that report was measured.
    pub pending_starts: u32,
}
