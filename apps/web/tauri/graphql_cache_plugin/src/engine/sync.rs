//! Streamed sync writes on the native engine. Each call applies one decoded
//! frame under the engine lock and releases it, so webview commands queue
//! between pages (tokio's mutex is fair) instead of waiting for the stream.

use super::access::EngineAccess;
use super::{AffectedOperationsResultWire, EngineState, WriteResultWire, wire_write_result};
use crate::sync::SyncFailure;
use cache_core::engine::Engine;
use cache_core::predicate::ProjectionMutation;
use cache_core::sync::{
    SyncApplied, SyncHooks, SyncLaneState, SyncPageWrite, SyncRun, SyncStartArgs, SyncWriteError,
};
use cache_core::value::EntityKey;
use cache_turso::{TursoStorage, TursoStorageError};
use soup_filter_cache_adapter::WriteResponse;
use soup_filter_cache_adapter::host_projections::{
    ProjectionFailure, deletion_projections, reuses_stored_identity, write_projections,
};
use std::collections::BTreeSet;
use std::sync::Weak;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// The native composition edge: the same projections as
/// `graphql_cache_hydrate` and `graphql_cache_delete_records`, and the host's
/// clocks. Monotonic time counts from the run's start.
pub(crate) struct NativeSyncHooks {
    started: Instant,
}

impl NativeSyncHooks {
    pub(crate) fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl SyncHooks<TursoStorage> for NativeSyncHooks {
    type Error = ProjectionFailure<TursoStorageError>;

    async fn page_projections(
        &self,
        engine: &mut Engine<TursoStorage>,
        page: SyncPageWrite<'_>,
    ) -> Result<Vec<ProjectionMutation>, Self::Error> {
        let reuse = reuses_stored_identity(engine, page.identity)
            .await
            .map_err(ProjectionFailure::Engine)?;
        let schema = engine.schema_snapshot();
        let response = WriteResponse::with_updates(
            &schema,
            page.query,
            page.operation_name,
            page.variables,
            page.data,
            page.updates,
        );
        write_projections(engine, page.operation, &response, reuse).await
    }

    async fn deletion_projections(
        &self,
        engine: &mut Engine<TursoStorage>,
        keys: &[EntityKey<'static>],
    ) -> Result<Vec<ProjectionMutation>, Self::Error> {
        let keys = keys.iter().map(ToString::to_string).collect::<Vec<_>>();
        deletion_projections(engine, &keys).await
    }

    fn monotonic_ms(&self) -> f64 {
        self.started.elapsed().as_secs_f64() * 1_000.0
    }

    fn wall_clock_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| {
                i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
            })
    }
}

/// What one applied frame changed, for webview notifications.
pub(crate) enum SyncPublication {
    /// Only sync state changed.
    Recorded,
    /// A page was hydrated; notify like a background hydration.
    Hydrated {
        /// The hydration write.
        write: WriteResultWire,
        /// Quick Access buckets the page changed.
        search_changed_buckets: BTreeSet<String>,
    },
    /// Records the server no longer lists were deleted; notify like
    /// `graphql_cache_delete_records`.
    Deleted {
        /// Deleted record keys. Webview events no longer carry keys; tests
        /// read them.
        #[cfg_attr(not(test), allow(dead_code))]
        keys: Vec<String>,
        /// Revision and the operations that read the keys.
        affected: AffectedOperationsResultWire,
    },
    /// A calendar window was committed; notify like `graphql_cache_calendar_commit`.
    CalendarCommitted(WriteResultWire),
}

/// The engine as a streamed sync run holds it: without keeping it alive, so
/// shutting the cache down (app exit) never waits on a stream. Frames take
/// the foreground turn (`lock`): they keep FIFO order with commands and do
/// not supersede in-flight cache warming.
#[derive(Clone)]
pub(crate) struct WeakEngineHandle(pub(super) Weak<EngineAccess<EngineState>>);

impl WeakEngineHandle {
    /// Starts a run at `started_at_ms`: its request carries every lane's saved
    /// state and, when it syncs calendars, the cache's calendar coverage.
    pub(crate) async fn sync_begin(
        &self,
        args: &SyncStartArgs,
        started_at_ms: f64,
    ) -> Result<SyncRun, SyncFailure> {
        let inner = self.0.upgrade().ok_or(SyncFailure::Aborted)?;
        let state = inner.lock().await;
        state
            .engine
            .sync_begin(args, started_at_ms)
            .await
            .map_err(|error| match error {
                SyncWriteError::Stream(error) => SyncFailure::Stream {
                    message: error.to_string(),
                },
                SyncWriteError::Engine(error) => SyncFailure::Write {
                    message: error.to_string(),
                },
                SyncWriteError::Hooks(never) => match never {},
            })
    }

    /// Applies the oldest decoded frame of `run`: at most one engine write.
    /// `None` when no frame is pending.
    pub(crate) async fn sync_apply_next(
        &self,
        run: &mut SyncRun,
        hooks: &NativeSyncHooks,
    ) -> Result<Option<SyncPublication>, SyncFailure> {
        // The cache was shut down or replaced: the run stops with it.
        let inner = self.0.upgrade().ok_or(SyncFailure::Aborted)?;
        let mut state = inner.lock().await;
        let EngineState { engine, ops, .. } = &mut *state;
        let applied = engine
            .sync_apply_next(run, hooks)
            .await
            .map_err(|error| match error {
                SyncWriteError::Stream(error) => SyncFailure::Stream {
                    message: error.to_string(),
                },
                SyncWriteError::Engine(error) => SyncFailure::Write {
                    message: error.to_string(),
                },
                SyncWriteError::Hooks(error) => SyncFailure::Write {
                    message: error.to_string(),
                },
            })?;
        Ok(applied.map(|applied| match applied {
            SyncApplied::Recorded => SyncPublication::Recorded,
            SyncApplied::Hydrated { result, .. } => SyncPublication::Hydrated {
                write: wire_write_result(ops, result.write_result),
                search_changed_buckets: result.search_changed_buckets,
            },
            SyncApplied::Deleted { keys, affected, .. } => SyncPublication::Deleted {
                keys: keys.into_iter().map(|key| key.0.into_owned()).collect(),
                affected: AffectedOperationsResultWire {
                    revision: affected.revision.to_string(),
                    affected_ops: ops.names(affected.value),
                },
            },
            SyncApplied::CalendarCommitted { result, .. } => {
                SyncPublication::CalendarCommitted(wire_write_result(ops, result))
            }
        }))
    }
}

impl super::EngineHandle {
    /// A handle that does not keep the engine alive.
    pub(crate) fn downgrade(&self) -> WeakEngineHandle {
        WeakEngineHandle(std::sync::Arc::downgrade(&self.inner))
    }

    /// Saved state of every lane that has run against this database.
    pub async fn sync_lane_states(&self) -> Result<Vec<SyncLaneState>, String> {
        self.inner
            .lock()
            .await
            .engine
            .sync_lane_states()
            .await
            .map_err(|error| error.to_string())
    }
}
