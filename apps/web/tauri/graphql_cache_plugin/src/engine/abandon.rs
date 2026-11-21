//! Reads whose caller stopped waiting. Tauri cannot cancel a command, so a
//! read the webview timed out on still waits for the engine and runs. After a
//! stall those reads queue ahead of the ones a caller still waits for, which
//! then time out too. A read sent with a request id registers it here; the
//! webview sends that id to `graphql_cache_abandon` when it stops waiting, and
//! the read leaves the engine's queue. A read that already holds the engine
//! finishes: only the wait is given up, never part of a read.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

/// Request ids are opaque webview strings; longer ones are not registered.
const MAX_REQUEST_ID_LEN: usize = 128;

pub(super) const ABANDONED: &str = "graphql cache read abandoned by its caller";

/// The reads now running with a request id, shared by every handle of one
/// engine.
#[derive(Default)]
pub(super) struct Abandons(Mutex<HashMap<String, Arc<Signal>>>);

impl Abandons {
    /// Registers a read until the returned registration drops.
    pub(super) fn register(self: &Arc<Self>, id: String) -> Option<Registration> {
        if id.len() > MAX_REQUEST_ID_LEN {
            return None;
        }
        let signal = Arc::new(Signal::default());
        self.0.lock().ok()?.insert(id.clone(), Arc::clone(&signal));
        Some(Registration {
            abandons: Arc::clone(self),
            id,
            signal,
        })
    }

    #[cfg(test)]
    pub(super) fn running(&self) -> usize {
        self.0.lock().map_or(0, |reads| reads.len())
    }

    /// Marks the read with this id abandoned. An id that is not running (it
    /// finished, or never came) is ignored.
    pub(super) fn abandon(&self, id: &str) {
        let signal = self.0.lock().ok().and_then(|reads| reads.get(id).cloned());
        if let Some(signal) = signal {
            signal.abandoned.store(true, Ordering::SeqCst);
            signal.notify.notify_waiters();
        }
    }
}

#[derive(Default)]
struct Signal {
    abandoned: AtomicBool,
    notify: Notify,
}

/// One read's entry in [`Abandons`], removed when the read's command ends.
pub(super) struct Registration {
    abandons: Arc<Abandons>,
    id: String,
    signal: Arc<Signal>,
}

impl Registration {
    pub(super) fn is_abandoned(&self) -> bool {
        self.signal.abandoned.load(Ordering::SeqCst)
    }

    /// Resolves once the read is abandoned.
    pub(super) async fn abandoned(&self) {
        loop {
            // Register before checking, so an abandon in between is not lost.
            let notified = self.signal.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_abandoned() {
                return;
            }
            notified.await;
        }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut reads) = self.abandons.0.lock()
            && reads
                .get(&self.id)
                .is_some_and(|signal| Arc::ptr_eq(signal, &self.signal))
        {
            reads.remove(&self.id);
        }
    }
}
