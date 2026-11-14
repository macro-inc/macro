//! Waiting for the services, which run in other processes, to reach a state.

use std::time::Duration;

use rootcause::prelude::*;
use tokio::time::Instant;

/// How long a scenario waits for the services before it fails. Generous on
/// purpose: a wait ends as soon as its condition holds, so the limit only
/// costs time when a scenario is about to fail anyway.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// How often a condition is checked.
const CHECK_EVERY: Duration = Duration::from_millis(150);

/// Checks `condition` until it answers `Some`, and returns what it answered.
///
/// The services are separate processes observed through their HTTP API, the
/// database and the provider emulators, so nothing in this process can signal
/// that they are done; asking again is the only way to know. This is the one
/// place the suite does that. A scenario never sleeps.
///
/// `what` completes the sentence "timed out waiting for …". An error from
/// `condition` fails the wait at once: return `Ok(None)` for "not yet".
pub async fn eventually<T>(
    what: &str,
    timeout: Duration,
    mut condition: impl AsyncFnMut() -> Result<Option<T>, Report>,
) -> Result<T, Report> {
    let started = Instant::now();
    loop {
        // A check that never answers must not outlast the wait.
        let remaining = timeout.saturating_sub(started.elapsed());
        if let Ok(checked) = tokio::time::timeout(remaining, condition()).await
            && let Some(value) = checked?
        {
            return Ok(value);
        }
        if started.elapsed() >= timeout {
            bail!("timed out after {timeout:?} waiting for {what}");
        }
        tokio::time::sleep(CHECK_EVERY).await;
    }
}
