//! The background loop that runs due syncs. Leases in Postgres keep any
//! number of hosts from running one sync twice.

use std::sync::Arc;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::domain::ports::DatabaseSyncsService;
use crate::domain::service::LEASE;

/// A run is cut off well inside its lease, so no other worker takes the
/// sync while it still writes.
const RUN_TIMEOUT: Duration = Duration::from_secs(LEASE.as_secs() * 2 / 3);

/// How long to wait when nothing is due.
const IDLE: Duration = Duration::from_secs(2);

/// How long to wait after a run failed outright.
const BACKOFF: Duration = Duration::from_secs(10);

/// Run due syncs until `shutdown`. A run cut short leaves its lease to
/// expire; the next run resumes it without duplicating rows.
pub async fn run_worker<Service: DatabaseSyncsService>(
    service: Arc<Service>,
    shutdown: CancellationToken,
) {
    loop {
        let attempt = tokio::select! {
            _ = shutdown.cancelled() => return,
            attempt = tokio::time::timeout(RUN_TIMEOUT, service.run_due()) => attempt,
        };
        let pause = match attempt {
            Ok(Ok(true)) => Duration::ZERO,
            Ok(Ok(false)) => IDLE,
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, "running a database sync failed; retrying");
                BACKOFF
            }
            Err(_) => {
                tracing::warn!("a database sync run timed out; its lease will expire");
                Duration::ZERO
            }
        };
        tokio::select! {
            _ = shutdown.cancelled() => return,
            _ = tokio::time::sleep(pause) => {}
        }
    }
}
