//! Runs a source, restarting it with backoff when it fails, and reports its
//! failures as source health.

use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use crate::domain::model::{SourceHealth, SourceState};
use crate::domain::observation::{Change, Observation};
use crate::domain::source::{AgentSource, SourceError};
use crate::domain::store::Store;

const FIRST_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// Starts a source on `tracker`. `make` builds a fresh source for every
/// (re)start. The source runs until `cancel` fires or the store closes.
pub fn spawn_source<F>(store: &Store, make: F, tracker: &TaskTracker, cancel: CancellationToken)
where
    F: Fn() -> Box<dyn AgentSource> + Send + 'static,
{
    let observations = store.observations();
    tracker.spawn(async move {
        let mut restarts: u32 = 0;
        let mut backoff = FIRST_BACKOFF;

        loop {
            let started = tokio::time::Instant::now();
            let source = make();
            let kind = source.kind();
            // No span around the run: it lasts the source's whole life. Adapters
            // open `macrod.monitor.source.batch` per batch; a restart gets its own span.
            let result = source.run(observations.clone(), cancel.child_token()).await;

            if cancel.is_cancelled() || matches!(result, Err(SourceError::StoreClosed)) {
                return;
            }
            restarts += 1;
            // A source that ran for a while before failing starts its backoff over.
            if started.elapsed() > MAX_BACKOFF {
                backoff = FIRST_BACKOFF;
            }
            let span = tracing::info_span!(
                "macrod.monitor.source.restart",
                source = kind.name(),
                restarts,
                backoff_ms = u64::try_from(backoff.as_millis()).unwrap_or(u64::MAX),
            );
            let detail = match result {
                Err(SourceError::Internal(report)) => {
                    tracing::warn!(parent: &span, source = kind.name(), error = ?report, "monitor source failed");
                    String::from("failed; restarting")
                }
                Ok(()) | Err(SourceError::StoreClosed) => String::from("stopped"),
            };

            let health = SourceHealth {
                state: SourceState::Unhealthy,
                detail: Some(detail),
                restarts,
                ..SourceHealth::starting(kind)
            };
            let reported = observations
                .send(Observation {
                    source: kind,
                    change: Change::Health(health),
                })
                .instrument(span)
                .await;
            if reported.is_err() {
                return;
            }

            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(backoff) => {}
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    });
}
