//! Ports for overcommit: what a fleet measures of its host's memory, the
//! storage of hosts' settings, reports, hibernations and wakes, and which
//! computers are in use.

use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Utc};

use crate::domain::ids::{ComputerId, HostId};
use crate::domain::overcommit::{HostAgentLimits, HostOvercommit, MemoryReport, WakeAdmission};

/// A host's memory as its fleet measured it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostMemory {
    /// Resident memory on the host, guests and host together.
    pub report: MemoryReport,
    /// The memory limits the host enforces itself.
    pub limits: HostLimitsState,
    /// This control plane's guests.
    pub guests: Vec<GuestUsage>,
}

/// Whether a host enforces [`HostAgentLimits`] itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostLimitsState {
    /// It does, at these (`None` until first set).
    Enforced(Option<HostAgentLimits>),
    /// It cannot (dev Docker: containers share no parent cgroup).
    Unsupported,
}

/// One guest's power and use, as the host measured them. Without
/// `private_memory_bytes` and `cpu_usage_microseconds` a guest is never
/// hibernated by relief.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GuestUsage {
    /// The computer it runs.
    pub computer_id: ComputerId,
    /// Its memory is on disk and it has no process.
    pub hibernated: bool,
    /// Memory only it holds, in bytes; `None` without a process.
    pub private_memory_bytes: Option<u64>,
    /// Its memory the host swapped out, in bytes; `None` without a process.
    pub swap_bytes: Option<u64>,
    /// CPU time its process used since it started; `None` without a process.
    pub cpu_usage_microseconds: Option<u64>,
}

/// Storage for overcommit: hosts' settings and memory reports, and which
/// awake computers relief hibernated. A hibernated computer counts against
/// neither its host's allocation nor its live memory until it wakes.
pub trait OvercommitRepo: Send + Sync {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The host's settings, hardware and latest memory report.
    fn host_overcommit(
        &self,
        host: HostId,
    ) -> impl Future<Output = Result<Option<HostOvercommit>, Self::Err>> + Send;

    /// Store the host's latest memory report; an older one never replaces a newer.
    fn record_memory_report(
        &self,
        host: HostId,
        report: MemoryReport,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record which of the host's computers are hibernated, as its fleet
    /// observed them at `at`: these are marked (keeping an earlier mark),
    /// every other computer on the host is cleared.
    fn sync_hibernated(
        &self,
        host: HostId,
        hibernated: &[ComputerId],
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Mark one computer hibernated at `at`.
    fn mark_hibernated(
        &self,
        computer_id: ComputerId,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Ask for a hibernated computer to wake; the overcommit pass admits it
    /// as soon as its host has room. Returns whether it is hibernated (a
    /// computer holding memory needs no wake).
    fn request_wake(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The host's hibernated computers whose wake was asked for, longest
    /// waiting first.
    fn wakes_requested(
        &self,
        host: HostId,
    ) -> impl Future<Output = Result<Vec<ComputerId>, Self::Err>> + Send;

    /// Admit a hibernated computer's wake against its host, like a start,
    /// under the host's lock; an admitted computer counts against the host
    /// again at once. Undo with [`Self::mark_hibernated`] if the restore fails.
    fn admit_wake(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<WakeAdmission, Self::Err>> + Send;
}

/// What [`ComputersInUse::in_use`] resolves to.
pub type ComputersInUseFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<std::collections::HashSet<ComputerId>, rootcause::Report>>
            + Send
            + 'a,
    >,
>;

/// Which awake computers someone is using now: a live agent session or an
/// open shell or exec. Relief never hibernates them, however quiet their CPU.
/// Object-safe (boxed future) so the operator holds it as `Arc<dyn _>`.
pub trait ComputersInUse: Send + Sync + 'static {
    /// The computers among `candidates` in use.
    fn in_use<'a>(&'a self, candidates: &'a [ComputerId]) -> ComputersInUseFuture<'a>;
}

/// For control planes that cannot tell: every computer counts as in use, so
/// relief hibernates nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct EveryComputerInUse;

impl ComputersInUse for EveryComputerInUse {
    fn in_use<'a>(&'a self, candidates: &'a [ComputerId]) -> ComputersInUseFuture<'a> {
        Box::pin(async move { Ok(candidates.iter().copied().collect()) })
    }
}
