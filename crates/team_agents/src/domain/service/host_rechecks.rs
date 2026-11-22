//! Coalescing a person's asks to check a machine's hosting again: each ask
//! runs a full probe on the owner's machine.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::OnceCell;
use tokio::time::Instant;

use crate::domain::models::HarnessId;

/// At most one ask reaches a machine this often (per replica).
pub(super) const RECHECK_INTERVAL: Duration = Duration::from_secs(10);

/// The latest ask per machine.
#[derive(Default)]
pub(super) struct HostRechecks {
    asks: Mutex<HashMap<HarnessId, Ask>>,
}

struct Ask {
    started: Instant,
    /// Set once its send finished; later asks wait on it meanwhile.
    sent: Arc<OnceCell<()>>,
}

impl HostRechecks {
    /// Run `send` for `harness`, unless an ask for it is still in flight or
    /// started within [`RECHECK_INTERVAL`]: then join that one (waiting for
    /// it to finish) instead. Whether this call sent.
    pub(super) async fn ask<Nudge>(&self, harness: HarnessId, send: impl FnOnce() -> Nudge) -> bool
    where
        Nudge: Future<Output = ()>,
    {
        let now = Instant::now();
        let latest = {
            let mut asks = self.asks.lock().unwrap_or_else(PoisonError::into_inner);
            asks.retain(|_, ask| {
                !ask.sent.initialized() || now.duration_since(ask.started) < RECHECK_INTERVAL
            });
            Arc::clone(
                &asks
                    .entry(harness)
                    .or_insert_with(|| Ask {
                        started: now,
                        sent: Arc::default(),
                    })
                    .sent,
            )
        };
        let mut sent = false;
        latest
            .get_or_init(|| async {
                sent = true;
                send().await;
            })
            .await;
        sent
    }
}

#[cfg(test)]
mod test;
