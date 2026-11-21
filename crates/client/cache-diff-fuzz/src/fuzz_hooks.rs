//! Compiled as a child of the host's `engine` module (see `build.rs`), so it
//! reaches the engine state the host keeps private.

use super::EngineHandle;

impl EngineHandle {
    /// The host's idle point: checkpoint the WAL when it is due. Builds
    /// without the idle checkpoint keep Turso's own checkpoint in COMMIT, and
    /// this does nothing. Returns `(ran, wal_frames, backfilled_frames)`.
    pub(crate) async fn fuzz_idle(&self) -> Option<(bool, u64, u64)> {
        #[cfg(feature = "idle-checkpoint")]
        {
            let state = self.inner.lock().await;
            let checkpoint = state.engine.storage().checkpoint_if_due().ok()?;
            Some((
                checkpoint.ran,
                checkpoint.wal_frames,
                checkpoint.backfilled_frames,
            ))
        }
        #[cfg(not(feature = "idle-checkpoint"))]
        None
    }
}
