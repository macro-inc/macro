//! Named points where the agent can be killed on purpose, so the crash
//! harness (`crash-harness/`) can stop it exactly
//! between two steps and check what the next start makes of it.
//!
//! Only builds with the `crash-points` feature have them; in every other
//! build [`reach`] is empty and `serve` has no `--crash-at`.

/// A point between two steps of an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "crash-points", derive(clap::ValueEnum))]
pub enum CrashPoint {
    /// Create: disks prepared, no record saved yet.
    CreateDisksPrepared,
    /// Create: record saved stopped, boot not started.
    CreateRecordSaved,
    /// Launch: Firecracker running in its jail, snapshot not loaded.
    LaunchSpawned,
    /// Launch: process running, not yet in the record.
    LaunchReturned,
    /// Boot or wake: record saved running, `macro-restore` not run.
    LaunchSaved,
    /// Hibernate: `hibernating` saved, no snapshot taken.
    HibernateFlagSaved,
    /// Hibernate: snapshot written in the jail, not published.
    HibernateSnapshotCreated,
    /// Hibernate: snapshot published, the VM still runs.
    HibernatePublished,
    /// Hibernate: VM ended and jail removed, record not saved.
    HibernateEnded,
    /// Wake: record saved running, old hibernation not discarded.
    WakeSaved,
    /// Destroy: VM and disks gone, record not deleted.
    DestroyDisksDeleted,
    /// Golden build: guest booted in the golden jail, no snapshot.
    GoldenBooted,
}

#[cfg(feature = "crash-points")]
static ARMED: std::sync::OnceLock<CrashPoint> = std::sync::OnceLock::new();

/// Kill the agent with SIGKILL when it reaches `point`.
#[cfg(feature = "crash-points")]
pub fn arm(point: CrashPoint) {
    let _ = ARMED.set(point);
}

/// Where the agent passes `point`: SIGKILL if it is armed there, exactly
/// like `kill -9` (no destructors, no flush).
#[inline]
pub fn reach(point: CrashPoint) {
    #[cfg(feature = "crash-points")]
    if ARMED.get() == Some(&point) {
        tracing::warn!(point = ?point, "crash point reached; killing the agent");
        let _ =
            rustix::process::kill_process(rustix::process::getpid(), rustix::process::Signal::KILL);
    }
    #[cfg(not(feature = "crash-points"))]
    let _ = point;
}
