//! The one gate every backfill passes before it writes to the search index:
//! a cap on the backfill work in flight in this task, and a pause an operator
//! sets for every task at once through the backfill control store.

use std::{sync::Arc, time::Duration};

use tokio::sync::{OwnedSemaphorePermit, Semaphore, watch};
use tokio_util::sync::CancellationToken;
use tracing::{Instrument as _, field};

use super::ports::BackfillControl;

/// How often each task rereads the pause switch, so a flip reaches every task
/// within this long.
pub const PAUSE_POLL_INTERVAL: Duration = Duration::from_secs(10);

/// Shared by every backfill path in a task; clones share the cap and the pause.
#[derive(Clone)]
pub struct BackfillGate {
    permits: Arc<Semaphore>,
    capacity: u32,
    paused: watch::Receiver<bool>,
}

/// Backfill work admitted through the gate; dropping it frees its share of
/// the cap.
#[derive(Debug)]
#[must_use = "the work is admitted only while the permit is held"]
pub struct BackfillPermit {
    _permit: Option<OwnedSemaphorePermit>,
}

impl BackfillGate {
    /// A gate admitting at most `capacity` units of backfill work at once,
    /// none while `paused` holds `true`.
    pub fn new(capacity: u32, paused: watch::Receiver<bool>) -> Self {
        let capacity = capacity.max(1);
        Self {
            permits: Arc::new(Semaphore::new(capacity as usize)),
            capacity,
            paused,
        }
    }

    /// A gate that is never paused, for tests.
    #[cfg(test)]
    pub fn open(capacity: u32) -> Self {
        Self::new(capacity, watch::channel(false).1)
    }

    /// Whether an operator has paused backfills, as this task last read it.
    pub fn is_paused(&self) -> bool {
        *self.paused.borrow()
    }

    /// Wait while backfills are paused.
    pub async fn wait_unpaused(&self) {
        let mut paused = self.paused.clone();
        // A closed switch means its watcher stopped with the service.
        let _ = paused.wait_for(|paused| !*paused).await;
    }

    /// Admit `work` units of backfill: wait while backfills are paused, then
    /// until that much of the cap is free. Work larger than the cap takes all
    /// of it.
    pub async fn admit(&self, work: u32) -> BackfillPermit {
        let work = work.clamp(1, self.capacity);
        loop {
            self.wait_unpaused().await;
            let Ok(permit) = Arc::clone(&self.permits).acquire_many_owned(work).await else {
                // The gate never closes its semaphore.
                return BackfillPermit { _permit: None };
            };
            // A pause that arrived while this waited for the cap holds it too.
            if !self.is_paused() {
                return BackfillPermit {
                    _permit: Some(permit),
                };
            }
        }
    }
}

/// Keep `paused` in step with the control store until `stop`: read it now,
/// then every `interval`. A failed read keeps the last state.
pub async fn watch_pause<C: BackfillControl>(
    control: C,
    paused: watch::Sender<bool>,
    interval: Duration,
    stop: CancellationToken,
) {
    loop {
        let span = tracing::info_span!("search.backfill_pause_read", paused = field::Empty);
        async {
            match control.paused().await {
                Ok(now) => {
                    tracing::Span::current().record("paused", now);
                    if paused.send_replace(now) != now {
                        tracing::info!(paused = now, "backfill pause switch changed");
                    }
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "failed reading the backfill pause switch; keeping the last state");
                }
            }
        }
        .instrument(span)
        .await;
        tokio::select! {
            () = stop.cancelled() => break,
            () = tokio::time::sleep(interval) => {}
        }
    }
}

#[cfg(test)]
mod test;
