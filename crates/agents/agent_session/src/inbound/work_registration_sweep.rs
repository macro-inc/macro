//! Runs the work registration sweep on a schedule.

use std::time::Duration;

use crate::domain::work_registration::{SWEEP_BATCH, WorkRegistrations};

#[cfg(test)]
mod test;

/// How long after boot the first sweep runs, so a deploy's rolling restart is past first.
pub const WORK_REGISTRATION_SWEEP_INITIAL_DELAY: Duration = Duration::from_secs(60);

/// How often the sweep runs after that. The time rules are hours apart, so minutes late costs
/// nothing.
pub const WORK_REGISTRATION_SWEEP_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Sweeps once after `initial_delay`, then every `interval`, until `shutdown` resolves. A full
/// batch sweeps again right away. Replicas may sweep concurrently: each row ends once.
pub async fn run_work_registration_sweep(
    registrations: &impl WorkRegistrations,
    initial_delay: Duration,
    interval: Duration,
    shutdown: impl Future<Output = ()> + Send,
) {
    tokio::pin!(shutdown);
    let mut wait = initial_delay;
    loop {
        tokio::select! {
            () = &mut shutdown => return,
            () = tokio::time::sleep(wait) => {}
        }
        wait = match registrations.sweep().await {
            Ok(report) if report.total() >= SWEEP_BATCH => Duration::ZERO,
            Ok(_) => interval,
            Err(error) => {
                tracing::warn!(error = ?error, "work registration sweep failed");
                interval
            }
        };
    }
}
