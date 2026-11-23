//! Streamed cache sync. The worker opens the HTTP stream itself and feeds the
//! response bytes here; each decoded frame is applied as its own engine call so
//! the worker can queue it behind foreground reads.

use super::{
    BrowserEngine, BrowserStorage, CacheEngine, JsWriteResult, err_js, js_write_result, to_js,
};
use cache_core::predicate::ProjectionMutation;
use cache_core::sync::{
    SyncApplied, SyncHooks, SyncPageWrite, SyncRunResult, SyncStartArgs, SyncWriteError,
};
use cache_core::value::EntityKey;
use cache_turso::TursoStorageError;
use serde::Serialize;
use soup_filter_cache_adapter::WriteResponse;
use soup_filter_cache_adapter::host_projections::{
    ProjectionFailure, deletion_projections, reuses_stored_identity, write_projections,
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

/// Browser composition edge: the same projections as `hydrateQuery` and
/// `deleteKeys`, and the worker's clock.
struct BrowserSyncHooks;

impl SyncHooks<BrowserStorage> for BrowserSyncHooks {
    type Error = ProjectionFailure<TursoStorageError>;

    async fn page_projections(
        &self,
        engine: &mut BrowserEngine,
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
        engine: &mut BrowserEngine,
        keys: &[EntityKey<'static>],
    ) -> Result<Vec<ProjectionMutation>, Self::Error> {
        let keys = keys.iter().map(ToString::to_string).collect::<Vec<_>>();
        deletion_projections(engine, &keys).await
    }

    fn monotonic_ms(&self) -> f64 {
        js_sys::Date::now()
    }

    fn wall_clock_ms(&self) -> i64 {
        js_sys::Date::now() as i64
    }
}

/// What one applied frame changed, for the worker's fan-out.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum JsSyncApplied {
    /// No decoded frame was pending.
    Idle,
    /// Only sync state changed.
    Recorded,
    /// A page was hydrated; publish like `hydrateQuery`.
    Hydrated { lane: String, write: JsWriteResult },
    /// Unlisted members were deleted; publish like `deleteKeys`.
    #[serde(rename_all = "camelCase")]
    Deleted {
        lane: String,
        revision: String,
        changed: Vec<String>,
        affected_ops: Vec<String>,
    },
    /// A calendar window was committed; publish like `calendarCommit`.
    Calendar { lane: String, write: JsWriteResult },
}

#[derive(Serialize)]
#[serde(untagged)]
enum JsSyncFinish {
    Finished {
        ok: bool,
        result: SyncRunResult,
    },
    Failed {
        ok: bool,
        message: String,
        partial: SyncRunResult,
    },
}

/// A sync error the worker reports as a non-`write` failure kind.
fn sync_failure_js(kind: &str, message: impl std::fmt::Display) -> JsValue {
    let error = js_sys::Error::new(&message.to_string());
    // Setting a property on a fresh Error object cannot fail.
    let _ = js_sys::Reflect::set(
        &error,
        &JsValue::from_str("cacheSyncFailure"),
        &JsValue::from_str(kind),
    );
    error.into()
}

#[wasm_bindgen]
impl CacheEngine {
    /// Starts a run from JSON `SyncStartArgs` and resolves to the JSON request
    /// body to POST: the pass, every lane's saved state and, when the run
    /// syncs calendars, the cache's calendar coverage. One run at a time: a
    /// second start rejects with `cacheSyncFailure: 'busy'`.
    #[wasm_bindgen(js_name = syncBegin)]
    pub fn sync_begin(&self, args_json: String) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            if state.sync_run.is_some() {
                return Err(sync_failure_js("busy", "a sync run is already in progress"));
            }
            let args: SyncStartArgs = serde_json::from_str(&args_json).map_err(|error| {
                sync_failure_js("stream", format!("invalid sync arguments: {error}"))
            })?;
            let begun = state
                .engine_mut()?
                .sync_begin(&args, js_sys::Date::now())
                .await;
            let run = match begun {
                Ok(run) => run,
                Err(SyncWriteError::Stream(error)) => return Err(sync_failure_js("stream", error)),
                Err(SyncWriteError::Engine(error)) => return Err(state.engine_error(error)),
                Err(SyncWriteError::Hooks(never)) => match never {},
            };
            let body = run.request_body().to_string();
            state.sync_run = Some(run);
            Ok(JsValue::from_str(&body))
        })
    }

    /// Decodes response bytes into pending frames and resolves to how many
    /// are pending. Never writes.
    #[wasm_bindgen(js_name = syncFeed)]
    pub fn sync_feed(&self, bytes: Vec<u8>) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let run = state
                .sync_run
                .as_mut()
                .ok_or_else(|| sync_failure_js("aborted", "no sync run in progress"))?;
            let pending = run
                .push_bytes(&bytes)
                .map_err(|error| sync_failure_js("stream", error))?;
            Ok(JsValue::from_f64(pending as f64))
        })
    }

    /// Applies the oldest pending frame: at most one engine write.
    #[wasm_bindgen(js_name = syncApplyNext)]
    pub fn sync_apply_next(&self) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let mut run = state
                .sync_run
                .take()
                .ok_or_else(|| sync_failure_js("aborted", "no sync run in progress"))?;
            let result = state
                .engine_mut()?
                .sync_apply_next(&mut run, &BrowserSyncHooks)
                .await;
            state.sync_run = Some(run);
            let applied = match result {
                Ok(applied) => applied,
                Err(SyncWriteError::Stream(error)) => return Err(sync_failure_js("stream", error)),
                Err(SyncWriteError::Engine(error)) => return Err(state.engine_error(error)),
                Err(SyncWriteError::Hooks(failure)) => {
                    return Err(state.projection_failure(failure));
                }
            };
            let ops = ops.borrow();
            let applied = match applied {
                None => JsSyncApplied::Idle,
                Some(SyncApplied::Recorded) => JsSyncApplied::Recorded,
                Some(SyncApplied::Hydrated { lane, result }) => {
                    let mut write = js_write_result(result.write_result, &ops);
                    write.search_changed_buckets = Some(result.search_changed_buckets);
                    JsSyncApplied::Hydrated { lane, write }
                }
                Some(SyncApplied::Deleted {
                    lane,
                    keys,
                    affected,
                }) => JsSyncApplied::Deleted {
                    lane,
                    revision: affected.revision.to_string(),
                    changed: keys.into_iter().map(|key| key.0.into_owned()).collect(),
                    affected_ops: ops.names(affected.value),
                },
                Some(SyncApplied::CalendarCommitted { lane, result }) => JsSyncApplied::Calendar {
                    lane,
                    write: js_write_result(result, &ops),
                },
            };
            to_js(&applied)
        })
    }

    /// Ends the run once the response body is exhausted. Resolves to
    /// `{ ok: true, result }`, or `{ ok: false, message, partial }` when the
    /// stream ended inside a line, without `end`, or with `end: error`.
    #[wasm_bindgen(js_name = syncFinish)]
    pub fn sync_finish(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let run = state
                .sync_run
                .take()
                .ok_or_else(|| sync_failure_js("aborted", "no sync run in progress"))?;
            let now = js_sys::Date::now();
            to_js(&match run.finish(now) {
                Ok(result) => JsSyncFinish::Finished { ok: true, result },
                Err(error) => JsSyncFinish::Failed {
                    ok: false,
                    message: error.to_string(),
                    partial: run.partial(now),
                },
            })
        })
    }

    /// Drops the run and resolves to its progress, or `null` without a run.
    /// Pages already applied stay written; the next run resumes from them.
    #[wasm_bindgen(js_name = syncAbort)]
    pub fn sync_abort(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            match state.sync_run.take() {
                Some(run) => to_js(&run.partial(js_sys::Date::now())),
                None => Ok(JsValue::NULL),
            }
        })
    }

    /// Saved state of every lane that has run against this database.
    #[wasm_bindgen(js_name = syncState)]
    pub fn sync_state(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let result = state.engine_mut()?.sync_lane_states().await;
            match result {
                Ok(lanes) => to_js(&lanes),
                Err(SyncWriteError::Engine(error)) => Err(state.engine_error(error)),
                Err(SyncWriteError::Stream(error)) => Err(err_js(error)),
                Err(SyncWriteError::Hooks(never)) => match never {},
            }
        })
    }
}
