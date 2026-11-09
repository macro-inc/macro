//! Each viewer's share of the document-run pool: a few runs at once, the rest
//! waiting their turn instead of failing.
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Runs one viewer may have going at once; more wait their turn.
pub const RUNS_PER_VIEWER: usize = 2;

/// A viewer's run slots, and how many of their runs hold or wait for one.
struct Viewer {
    slots: Arc<Semaphore>,
    runs: usize,
}

/// Run slots per viewer. A viewer's entry lives while any of their runs holds
/// or waits for a slot.
#[derive(Default)]
pub(super) struct ViewerRuns(Mutex<HashMap<MacroUserIdStr<'static>, Viewer>>);

impl ViewerRuns {
    /// Wait up to `within` for one of `user`'s slots; `None` if none frees in
    /// time. Dropping the returned turn frees the slot.
    pub(super) async fn admit(
        &self,
        user: &MacroUserIdStr<'static>,
        within: Duration,
    ) -> Option<ViewerTurn<'_>> {
        let slots = {
            let mut viewers = self.0.lock().unwrap_or_else(PoisonError::into_inner);
            let viewer = viewers.entry(user.clone()).or_insert_with(|| Viewer {
                slots: Arc::new(Semaphore::new(RUNS_PER_VIEWER)),
                runs: 0,
            });
            viewer.runs += 1;
            Arc::clone(&viewer.slots)
        };
        // Created before the wait, so a run dropped while waiting leaves too.
        let mut turn = ViewerTurn {
            viewers: self,
            user: user.clone(),
            _slot: None,
        };
        let slot = tokio::time::timeout(within, slots.acquire_owned())
            .await
            .ok()?
            .ok()?;
        turn._slot = Some(slot);
        Some(turn)
    }

    #[cfg(test)]
    pub(super) fn viewers(&self) -> usize {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).len()
    }
}

/// A viewer's run, holding or waiting for a slot.
pub(super) struct ViewerTurn<'a> {
    viewers: &'a ViewerRuns,
    user: MacroUserIdStr<'static>,
    _slot: Option<OwnedSemaphorePermit>,
}

impl Drop for ViewerTurn<'_> {
    fn drop(&mut self) {
        let mut viewers = self
            .viewers
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let Some(viewer) = viewers.get_mut(&self.user) else {
            return;
        };
        viewer.runs = viewer.runs.saturating_sub(1);
        if viewer.runs == 0 {
            viewers.remove(&self.user);
        }
    }
}
