//! The one gate every backfill passes before it writes to the search index:
//! a cap on the backfill work in flight in this task, and a pause an operator
//! sets for every task at once through the backfill control store.
//!
//! Every wait is for one unit, so the semaphore's first-come order serves
//! direct backfills and queue workers alike: a worker that wants a batch
//! waits for one unit and takes the rest only if they are free.

use std::{sync::Arc, time::Duration};

use tokio::sync::{OwnedSemaphorePermit, Semaphore, watch};
use tokio_util::sync::CancellationToken;
use tracing::{Instrument as _, field};

use super::ports::BackfillControl;

/// How often each task rereads the pause switch, so a flip reaches every task
/// within this long plus one read.
pub const PAUSE_POLL_INTERVAL: Duration = Duration::from_secs(10);
/// How long one read of the pause switch may take before the task gives up
/// on it.
pub const PAUSE_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Shared by every backfill path in a task; clones share the cap and the pause.
#[derive(Clone)]
pub struct BackfillGate {
    permits: Arc<Semaphore>,
    capacity: u32,
    paused: watch::Receiver<bool>,
}

/// Backfill work admitted through the gate; dropping it frees its units.
#[derive(Debug)]
#[must_use = "the work is admitted only while the permit is held"]
pub struct BackfillPermit {
    permit: Option<OwnedSemaphorePermit>,
}

impl BackfillPermit {
    /// How many units this permit holds.
    pub fn units(&self) -> u32 {
        self.permit.as_ref().map_or(0, |permit| {
            u32::try_from(permit.num_permits()).unwrap_or(u32::MAX)
        })
    }

    /// Split off one unit, for one piece of the work this permit admitted.
    pub fn take_one(&mut self) -> Option<BackfillPermit> {
        let permit = self.permit.as_mut()?;
        if permit.num_permits() <= 1 {
            return self.permit.take().map(|permit| BackfillPermit {
                permit: Some(permit),
            });
        }
        permit.split(1).map(|permit| BackfillPermit {
            permit: Some(permit),
        })
    }
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
        if paused.wait_for(|paused| !*paused).await.is_err() && *paused.borrow() {
            // The switch's watcher stopped with the service while paused, so
            // no resume can arrive.
            std::future::pending::<()>().await;
        }
    }

    /// Admit one unit of backfill work: wait while backfills are paused, then
    /// until a unit of the cap is free.
    pub async fn admit(&self) -> BackfillPermit {
        if !self.is_paused()
            && let Ok(permit) = Arc::clone(&self.permits).try_acquire_owned()
        {
            return BackfillPermit {
                permit: Some(permit),
            };
        }
        let span = tracing::info_span!(
            "search.backfill_admit",
            paused = self.is_paused(),
            waited_ms = field::Empty,
        );
        let started = tokio::time::Instant::now();
        let permit = self.wait_for_unit().instrument(span.clone()).await;
        span.record(
            "waited_ms",
            u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        );
        permit
    }

    /// Admit between one and `most` units: wait for the first as [`Self::admit`]
    /// does, then take whatever else is free without waiting.
    pub async fn admit_up_to(&self, most: u32) -> BackfillPermit {
        let mut admitted = self.admit().await;
        if let Some(held) = admitted.permit.as_mut() {
            for _ in 1..most.min(self.capacity) {
                let Ok(more) = Arc::clone(&self.permits).try_acquire_owned() else {
                    break;
                };
                held.merge(more);
            }
        }
        admitted
    }

    async fn wait_for_unit(&self) -> BackfillPermit {
        loop {
            self.wait_unpaused().await;
            let Ok(permit) = Arc::clone(&self.permits).acquire_owned().await else {
                // The gate never closes its semaphore.
                return BackfillPermit { permit: None };
            };
            // A pause that arrived while this waited for the cap holds it too.
            if !self.is_paused() {
                return BackfillPermit {
                    permit: Some(permit),
                };
            }
        }
    }
}

/// The pause switch as the control store holds it, or `false` when it cannot
/// be read within `timeout`, so a task starts with the switch's state.
pub async fn read_pause<C: BackfillControl>(control: &C, timeout: Duration) -> bool {
    match tokio::time::timeout(timeout, control.paused()).await {
        Ok(Ok(paused)) => paused,
        Ok(Err(error)) => {
            tracing::warn!(error = ?error, "failed reading the backfill pause switch at start; starting unpaused");
            false
        }
        Err(_) => {
            tracing::warn!(
                "reading the backfill pause switch at start timed out; starting unpaused"
            );
            false
        }
    }
}

/// Keep `paused` in step with the control store until `stop`: read it every
/// `interval`. A failed or slow read keeps the last state.
pub async fn watch_pause<C: BackfillControl>(
    control: C,
    paused: watch::Sender<bool>,
    interval: Duration,
    stop: CancellationToken,
) {
    loop {
        tokio::select! {
            () = stop.cancelled() => break,
            () = tokio::time::sleep(interval) => {}
        }
        let span = tracing::info_span!(
            "search.backfill_pause_read",
            paused = field::Empty,
            outcome = field::Empty,
        );
        let read = async {
            match tokio::time::timeout(PAUSE_READ_TIMEOUT, control.paused()).await {
                Ok(Ok(now)) => {
                    tracing::Span::current()
                        .record("paused", now)
                        .record("outcome", "read");
                    if paused.send_replace(now) != now {
                        tracing::info!(paused = now, "backfill pause switch changed");
                    }
                }
                Ok(Err(error)) => {
                    tracing::Span::current().record("outcome", "failed");
                    tracing::warn!(error = ?error, "failed reading the backfill pause switch; keeping the last state");
                }
                Err(_) => {
                    tracing::Span::current().record("outcome", "timed_out");
                    tracing::warn!(
                        "reading the backfill pause switch timed out; keeping the last state"
                    );
                }
            }
        }
        .instrument(span);
        tokio::select! {
            () = stop.cancelled() => break,
            () = read => {}
        }
    }
}

#[cfg(test)]
mod test;
