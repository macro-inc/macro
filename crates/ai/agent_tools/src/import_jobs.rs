//! Where a host runs Notion workspace imports, so they outlive its shutdown.

use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// How long a host waits for its running imports to hand their runs over.
/// Past it, their leases lapse and another process adopts them anyway.
pub const IMPORT_JOBS_HANDOVER_TIMEOUT: Duration = Duration::from_secs(10);

/// The shutdown signal and tracker a host's import service runs its jobs
/// on. On shutdown the host calls [`ImportJobs::hand_over`]: each running
/// planning or write job stops at its next checkpoint and releases its run,
/// which another process adopts at once.
#[derive(Clone, Default)]
pub struct ImportJobs {
    /// Cancelled when the host shuts down.
    pub shutdown: CancellationToken,
    /// Every import job the host runs.
    pub tracker: TaskTracker,
}

impl ImportJobs {
    /// Jobs for a new host.
    pub fn new() -> Self {
        Self::default()
    }

    /// Stop running imports and wait for them to hand their runs over, up to
    /// [`IMPORT_JOBS_HANDOVER_TIMEOUT`].
    pub async fn hand_over(&self) {
        self.shutdown.cancel();
        self.tracker.close();
        match tokio::time::timeout(IMPORT_JOBS_HANDOVER_TIMEOUT, self.tracker.wait()).await {
            Ok(()) => tracing::info!("import jobs handed over"),
            Err(error) => tracing::warn!(
                error = ?error,
                timeout_seconds = IMPORT_JOBS_HANDOVER_TIMEOUT.as_secs(),
                "timed out handing import jobs over; their leases lapse instead"
            ),
        }
    }
}
