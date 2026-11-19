//! Provider-specific worker admission, refreshed from the feature flag service.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

/// Separate read-sync and mutation gates. Clones see the same current snapshot.
#[derive(Clone, Default)]
pub struct MailboxRuntime {
    sync: Arc<AtomicBool>,
    writes: Arc<AtomicBool>,
}
impl MailboxRuntime {
    /// Apply one evaluated snapshot; failures are represented as both disabled.
    pub fn set(&self, sync: bool, writes: bool) {
        self.sync.store(sync, Ordering::Release);
        self.writes.store(writes, Ordering::Release);
    }
    /// Whether new provider synchronization work can be claimed.
    pub fn sync_enabled(&self) -> bool {
        self.sync.load(Ordering::Acquire)
    }
    /// Whether new provider mutations can be claimed.
    pub fn writes_enabled(&self) -> bool {
        self.writes.load(Ordering::Acquire)
    }
}
