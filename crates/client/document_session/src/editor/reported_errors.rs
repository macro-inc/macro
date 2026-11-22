use lexical_model::{Error, FollowUpErrorObserver};
use std::sync::{Arc, Mutex};
/// Metadata-only observation of an actual error and its SessionOutput.view index.
/// Implementations must not call JS, perform I/O, reenter, or mutate output.
pub trait ReportedModelErrorObserver: Send + Sync {
    /// Borrow the original cause at the exact corresponding view-effect push.
    fn reported(&self, error: &Error, view_index: usize);
}
#[derive(Default)]
pub(crate) struct Capture(Mutex<Vec<(usize, Arc<Error>)>>);
impl Capture {
    pub(super) fn clear(&self) {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }
    pub(super) fn take(&self) -> Vec<(usize, Arc<Error>)> {
        std::mem::take(
            &mut *self
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }
}
impl FollowUpErrorObserver for Capture {
    fn reported(&self, error: &Arc<Error>, effect_index: usize) {
        // No user callback runs under this metadata lock. Retain only actual causes.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push((effect_index, error.clone()));
    }
}
