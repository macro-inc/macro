//! Streamed sync writes on the native engine. Each call applies one decoded
//! frame under the engine lock and releases it, so webview commands queue
//! between pages (tokio's mutex is fair) instead of waiting for the stream.

use super::access::EngineAccess;
use super::authority::AuthorityListener;
use super::{AffectedOperationsResultWire, EngineState, WriteResultWire, wire_write_result};
use cache_core::engine::Engine;
use cache_core::predicate::ProjectionMutation;
use cache_core::sync::{
    SyncApplied, SyncHooks, SyncLaneState, SyncPageWrite, SyncRun, SyncStartArgs, SyncStreamError,
    SyncWriteError,
};
use cache_core::value::EntityKey;
use cache_turso::{TursoStorage, TursoStorageError};
use soup_filter_cache_adapter::WriteResponse;
use soup_filter_cache_adapter::host_projections::{
    ProjectionFailure, deletion_projections, reuses_stored_identity, write_projections,
};
use std::collections::BTreeSet;
use std::sync::{Arc, Weak};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Why a run did not complete (`SyncFailure` in `sync-protocol.ts`). Here,
/// not in the plugin's `sync` module, because the fuzzer compiles this
/// engine module without the plugin around it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncFailure {
    /// Another run is in progress.
    Busy,
    /// This host cannot stream (no opener installed).
    Unsupported,
    /// Stopped by `sync_stop`, suspension, clear, or cache shutdown.
    Aborted,
    /// The server answered with a non-success status.
    Http {
        /// Response status.
        status: u16,
        /// The response's `Retry-After`, when it gave one in seconds.
        #[serde(rename = "retryAfterMs", skip_serializing_if = "Option::is_none")]
        retry_after_ms: Option<u64>,
    },
    /// The request failed, or the stream broke the contract or ended early.
    Stream {
        /// Diagnostic.
        message: String,
    },
    /// No response, or no response bytes, for the run's stall timeout.
    Stalled,
    /// Writing a frame into the cache failed.
    Write {
        /// Diagnostic.
        message: String,
    },
}

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
        #[cfg(test)]
        keys: Vec<String>,
        /// Revision and the operations that read the keys.
        affected: AffectedOperationsResultWire,
    },
    /// A calendar window was committed; notify like `graphql_cache_calendar_commit`.
    CalendarCommitted(WriteResultWire),
    /// A frame's write failed, possibly after committing part of it; notify
    /// like a write without change hints, so every view refreshes.
    WriteFailed {
        /// The engine's revision after the failure.
        revision: String,
    },
}

/// A frame that did not apply.
pub(crate) struct SyncApplyFailure {
    /// Why the run stops.
    pub(crate) failure: SyncFailure,
    /// What to publish before the run stops.
    pub(crate) publication: Option<SyncPublication>,
}

impl From<SyncFailure> for SyncApplyFailure {
    fn from(failure: SyncFailure) -> Self {
        Self {
            failure,
            publication: None,
        }
    }
}

/// The engine as a streamed sync run holds it: without keeping it alive, so
/// shutting the cache down (app exit) never waits on a stream. Frames take
/// the foreground turn (`lock`): they keep FIFO order with commands and do
/// not supersede in-flight cache warming.
#[derive(Clone)]
pub(crate) struct WeakEngineHandle {
    inner: Weak<EngineAccess<EngineState>>,
    /// The handle's authority listener, told when a page starts a new
    /// authority generation.
    authority_listener: Option<Arc<AuthorityListener>>,
}

impl WeakEngineHandle {
    /// Starts a run at `started_at_ms`: its request carries every lane's saved
    /// state and, when it syncs calendars, the cache's calendar coverage.
    pub(crate) async fn sync_begin(
        &self,
        args: &SyncStartArgs,
        started_at_ms: f64,
    ) -> Result<SyncRun, SyncFailure> {
        let inner = self.inner.upgrade().ok_or(SyncFailure::Aborted)?;
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

    /// Applies the oldest decoded frame of `run`: a few bounded engine
    /// writes at most. `None` when no frame is pending.
    pub(crate) async fn sync_apply_next(
        &self,
        run: &mut SyncRun,
        hooks: &NativeSyncHooks,
    ) -> Result<Option<SyncPublication>, SyncApplyFailure> {
        // The cache was shut down or replaced: the run stops with it.
        let inner = self.inner.upgrade().ok_or(SyncFailure::Aborted)?;
        let mut state = inner.lock().await;
        let EngineState { engine, ops, .. } = &mut *state;
        let generation = engine
            .authority_snapshot()
            .map(|authority| authority.generation);
        let applied = engine.sync_apply_next(run, hooks).await;
        // A page for another account resets the cache under a new authority
        // generation. Publish it before giving the engine back, as hydration
        // does, so no later notification goes out ahead of it. After a reset
        // the engine ends the run at its next frame; only a change is
        // published here.
        if let Some(listener) = &self.authority_listener
            && let Some(current) = engine.authority_snapshot()
            && generation != Some(current.generation)
        {
            listener(current);
        }
        let applied = match applied {
            Ok(applied) => applied,
            // The cache was cleared, reset or given a new authority generation
            // under the run (logout, another account, a permission change):
            // the run stops without writing, as on a stop.
            Err(SyncWriteError::Stream(SyncStreamError::Superseded)) => {
                return Err(SyncFailure::Aborted.into());
            }
            Err(SyncWriteError::Stream(error)) => {
                return Err(SyncFailure::Stream {
                    message: error.to_string(),
                }
                .into());
            }
            // A write that fails may already have committed part of the
            // frame, so views refresh against the current revision rather
            // than miss it.
            Err(error) => {
                return Err(SyncApplyFailure {
                    failure: SyncFailure::Write {
                        message: error.to_string(),
                    },
                    publication: Some(SyncPublication::WriteFailed {
                        revision: engine.current_revision().to_string(),
                    }),
                });
            }
        };
        Ok(applied.map(|applied| match applied {
            SyncApplied::Recorded => SyncPublication::Recorded,
            SyncApplied::Hydrated { result, .. } => SyncPublication::Hydrated {
                write: wire_write_result(ops, result.write_result),
                search_changed_buckets: result.search_changed_buckets,
            },
            SyncApplied::Deleted {
                #[cfg(test)]
                keys,
                affected,
                ..
            } => SyncPublication::Deleted {
                #[cfg(test)]
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
        WeakEngineHandle {
            inner: Arc::downgrade(&self.inner),
            authority_listener: self
                .authority_listener
                .as_ref()
                .map(|(_, listener)| Arc::clone(listener)),
        }
    }

    /// Keeps a sync run begun before now from writing these records back: the
    /// app changed them outside the cache's writes. Nothing without a run.
    pub async fn sync_fence(&self, keys: Vec<String>) {
        let keys: Vec<EntityKey<'static>> =
            keys.into_iter().map(|key| EntityKey(key.into())).collect();
        self.inner.lock().await.engine.fence_sync_records(&keys);
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

    /// Holds the engine as a long command does: `held` fires once it has
    /// it, and it gives it back when `release` fires.
    #[cfg(test)]
    pub(crate) async fn hold(
        &self,
        held: tokio::sync::oneshot::Sender<()>,
        release: tokio::sync::oneshot::Receiver<()>,
    ) {
        let _state = self.inner.lock().await;
        let _ = held.send(());
        let _ = release.await;
    }
}
