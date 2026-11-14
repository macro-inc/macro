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
            let span =
                tracing::info_span!("macrod.monitor.source.run", source = kind.name(), restarts);
            let result = source
                .run(observations.clone(), cancel.child_token())
                .instrument(span)
                .await;

            if cancel.is_cancelled() {
                return;
            }
            let detail = match result {
                Err(SourceError::StoreClosed) => return,
                Ok(()) => String::from("stopped"),
                Err(SourceError::Internal(report)) => {
                    tracing::warn!(source = kind.name(), error = ?report, "monitor source failed");
                    String::from("failed; restarting")
                }
            };

            restarts += 1;
            // A source that ran for a while before failing starts its backoff over.
            if started.elapsed() > MAX_BACKOFF {
                backoff = FIRST_BACKOFF;
            }
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
