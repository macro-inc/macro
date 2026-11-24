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

/// A hydrate staged ahead of the op before it (see [`EngineHandle::fuzz_stage_hydrate`]).
#[cfg(staged_hydrate)]
pub(crate) struct FuzzStagedHydrate {
    projections: Vec<cache_core::predicate::ProjectionMutation>,
    staged: Option<cache_core::engine::StagedHydrate>,
    wal: Option<cache_turso::WalPosition>,
    /// Why staging failed: the browser host's `prepareHydrate` then rejects,
    /// so the hydrate answers with this error at its turn.
    pub error: Option<String>,
}

#[cfg(staged_hydrate)]
impl FuzzStagedHydrate {
    /// Whether a write was computed.
    pub(crate) fn staged(&self) -> bool {
        self.staged.is_some()
    }
}

#[cfg(staged_hydrate)]
impl EngineHandle {
    /// Does what the browser host's `prepareHydrate` and `stageHydrate` do:
    /// reads the projections the hydrate changes and computes its write,
    /// writing nothing, with the storage position they were read at.
    pub(crate) async fn fuzz_stage_hydrate(
        &self,
        request: crate::exec::HydrateRequest<'_>,
    ) -> Result<FuzzStagedHydrate, String> {
        let mut state = self.snapshot_hydration().await?;
        let engine = &mut state.engine;
        // The position before anything is read: a write between here and the
        // commit moves it, whatever the stage read.
        let wal = engine.storage().wal_position().ok();
        let projections = match super::soup::write_projections(
            engine,
            request.query,
            request.operation_name,
            request.variables,
            request.data,
            request.identity,
            // A host that shares the write's normalization with the passes
            // takes it here; none makes the passes normalize the response.
            #[cfg(write_projections_normalized)]
            None,
        )
        .await
        {
            Ok(projections) => projections,
            Err(error) => {
                return Ok(FuzzStagedHydrate {
                    projections: Vec::new(),
                    staged: None,
                    wal,
                    error: Some(error.to_string()),
                });
            }
        };
        let staged = engine
            .stage_hydrate(
                super::NetworkWrite {
                    query: request.query,
                    operation_name: request.operation_name,
                    variables: request.variables,
                    data: request.data,
                    identity: request.identity,
                },
                request.scope,
                &projections,
            )
            .await;
        let (staged, error) = match staged {
            Ok(staged) => (staged, None),
            Err(error) => (None, Some(error.to_string())),
        };
        Ok(FuzzStagedHydrate {
            projections,
            staged,
            wal,
            error,
        })
    }

    /// Does what the browser host's `commitHydrate` does with a staged write:
    /// commits it while storage is where it was staged and the engine says it
    /// is current. `None` when it can't, and the hydrate runs whole; a stage
    /// that failed answers with its error while storage has not moved since.
    pub(crate) async fn fuzz_commit_staged_hydrate(
        &self,
        staged: FuzzStagedHydrate,
    ) -> Option<Result<super::HydrationWriteResultWire, String>> {
        let FuzzStagedHydrate {
            projections,
            staged,
            wal,
            error,
        } = staged;
        let mut state = match self.snapshot_hydration().await {
            Ok(state) => state,
            Err(error) => return Some(Err(error)),
        };
        let super::EngineState { engine, ops, .. } = &mut *state;
        // A stage that storage moved past since (or that read no position)
        // proves nothing about the hydrate at its turn, failed or not.
        if wal.is_none() || engine.storage().wal_position().ok() != wal {
            return None;
        }
        if let Some(error) = error {
            return Some(Err(error));
        }
        let staged = staged?;
        if !engine.staged_hydrate_current(&staged) {
            return None;
        }
        let result = match engine.commit_staged_hydrate(staged, projections).await {
            Ok(result) => result,
            Err(error) => return Some(Err(error.to_string())),
        };
        let unchanged_views = engine
            .unchanged_observed_windows()
            .await
            .unwrap_or_default();
        self.publish_bound_generation(engine);
        Some(Ok(super::HydrationWriteResultWire {
            unchanged_views,
            search_changed_buckets: result.search_changed_buckets,
            write_result: super::wire_write_result(ops, result.write_result),
            data: result.data,
        }))
    }
}

/// What a read abandoned before its turn fails with.
#[cfg(abandon_reads)]
pub(crate) const FUZZ_ABANDONED: &str = super::abandon::ABANDONED;

#[cfg(abandon_reads)]
impl EngineHandle {
    /// Runs `during` while this engine is held, as a long write or a stall
    /// holds it, so reads sent meanwhile queue for it.
    pub(crate) async fn fuzz_while_held<F: std::future::Future>(&self, during: F) -> F::Output {
        let _held = self.inner.lock().await;
        during.await
    }
}
