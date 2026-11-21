//! Compiled as a child of the host's `engine` module (see `build.rs`), so it
//! reaches the engine state the host keeps private.

use super::EngineHandle;

impl EngineHandle {
    /// The host's idle point: checkpoint the WAL when it is due. Builds
    /// without the idle checkpoint keep Turso's own checkpoint in COMMIT, and
    /// this returns `None`. Otherwise it returns `(ran, backfilled_frames)`, or
    /// the checkpoint's error.
    pub(crate) async fn fuzz_idle(&self) -> Option<Result<(bool, u64), String>> {
        #[cfg(idle_checkpoint)]
        {
            let state = self.inner.lock().await;
            Some(
                state
                    .engine
                    .storage()
                    .checkpoint_if_due()
                    .map(|checkpoint| (checkpoint.ran, checkpoint.backfilled_frames))
                    .map_err(|error| error.to_string()),
            )
        }
        #[cfg(not(idle_checkpoint))]
        None
    }
}
