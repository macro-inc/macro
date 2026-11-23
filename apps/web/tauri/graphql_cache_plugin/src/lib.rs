//! Tauri-native host for the normalized GraphQL cache.
//!
//! The webview counterpart of the browser worker glue in
//! `apps/web/src/lib/graphql-cache/`: the engine (`cache-core` over
//! `cache-turso`) lives in the Tauri host process behind an async mutex
//! (`Storage` futures are `MaybeSend`, so `Send` on native) — one shared
//! instance across all webviews/windows, never webview storage.
//! Webviews talk to it through the commands in [`commands`] (registered
//! app-level in `src-tauri`, like the bundle updater plugin) and receive
//! operation, cache-change, and queued-mutation settlement notifications via
//! broadcast events. These mirror browser worker pushes; each webview's
//! `CacheHost` filters operation ids by its own client prefix.
//!
//! Streamed cache sync ([`sync`]) runs here too: the plugin opens the stream
//! through the opener the app installs and publishes each written page with
//! the same events, so no sync data passes through a webview.
//!
//! Design doc: `apps/web/docs/graphql-normalized-cache-plan.md`.

#![deny(missing_docs)]

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

pub mod commands;
mod engine;
pub mod sync;

pub use engine::{
    AffectedOperationsResultWire, CalendarRangeResultWire, ClaimedMutationWire,
    CommitOptimisticWriteResultWire, DeferOptimisticWriteResultWire, EngineHandle,
    EnqueueOptimisticMutationResultWire, EntityFilterRequest, EntityFilterResult,
    InitialMutationClaimWire, PredicateBaselineEntry, PredicateFilterResult, ReadResultWire,
    RecordSelectionResultWire, RollbackOptimisticWriteResultWire, WriteResultWire,
};

/// Broadcast event carrying [`OpsAffectedEvent`]: operations whose
/// underlying records changed. Emitted to every webview; hosts filter by
/// their own client-id prefix (the origin operation is already excluded by
/// the engine).
pub const OPS_AFFECTED_EVENT: &str = "graphql-cache://ops-affected";

/// Broadcast event emitted whenever the effective cache view changes.
pub const CACHE_CHANGED_EVENT: &str = "graphql-cache://cache-changed";

/// Broadcast [`CacheChangedEvent`] for background hydration, which only
/// hydration subscribers observe. Webview hosts emit it after their own
/// `graphql_cache_hydrate` calls; the plugin emits it for streamed sync pages.
pub const CACHE_HYDRATED_EVENT: &str = "graphql-cache://cache-hydrated";

/// Broadcast event carrying the final outcome of a queued mutation.
pub const MUTATION_SETTLED_EVENT: &str = "graphql-cache://mutation-settled";

/// Payload of [`OPS_AFFECTED_EVENT`] — mirrors the worker `CachePush`
/// message in `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsAffectedEvent {
    /// Permission generation that produced these patches.
    pub authority_generation: Option<String>,
    /// Composed record changes, including optimistic rollback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_changes: Option<Vec<cache_core::field_changes::RecordFieldChange>>,
    /// Registered operation ids (`"{clientId}:{urqlKey}"`) to re-execute.
    pub op_ids: Vec<String>,
}

/// Payload of [`CACHE_CHANGED_EVENT`].
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheChangedEvent {
    /// Permission generation that produced these invalidation proofs.
    pub authority_generation: Option<String>,
    /// Exact displayed windows unaffected by every change in this notification.
    #[serde(skip_serializing_if = "Option::is_none")]
    unchanged_views: Option<Vec<String>>,
    /// Known query-write changes; missing metadata requests a conservative refresh.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_changed_buckets: Option<std::collections::BTreeSet<String>>,
    /// Effective-view revision installed by the logical mutation.
    pub revision: String,
    /// Present when the write cleared durable records and hydration must restart.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MutationSettledEvent {
    transaction_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mutation_uuid: Option<String>,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replacement_transaction_id: Option<String>,
}

#[cfg(test)]
mod test;

struct InitializedCache {
    scope: String,
    handle: EngineHandle,
}

/// Managed state holding the lazily-initialized engine handle and the
/// streamed sync run. Register with `.manage(CacheState::default())` in the
/// app builder.
#[derive(Default)]
pub struct CacheState {
    cache: Mutex<Option<InitializedCache>>,
    sync: sync::SyncRuns,
}

impl CacheState {
    /// State holding an already initialized cache and no sync run.
    #[cfg(test)]
    pub(crate) fn with_cache(cache: InitializedCache) -> Self {
        Self {
            cache: Mutex::new(Some(cache)),
            sync: sync::SyncRuns::default(),
        }
    }

    /// Installs how streamed sync opens its stream (the app does this at
    /// setup). Until then `graphql_cache_sync_start` answers `unsupported`.
    pub fn install_sync_opener(&self, opener: Arc<dyn sync::SyncStreamOpener>) {
        self.sync.install_opener(opener);
    }

    /// Stops the streamed sync run, if any, without waiting. Pages already
    /// written are kept; the next run resumes from them.
    pub fn stop_sync(&self) {
        self.sync.cancel();
    }

    /// Stops sync (waiting for a page being written), takes the initialized
    /// cache and explicitly closes its Turso connection. Blocks, so call it
    /// only off the async runtime's worker threads (app exit, a blocking task).
    pub fn shutdown(&self) -> Result<(), String> {
        self.sync.stop_blocking();
        let cache = self
            .cache
            .lock()
            .map_err(|_| "graphql cache state poisoned".to_string())?
            .take();
        cache.map_or(Ok(()), |cache| cache.handle.shutdown())
    }
}

fn emit_ops_affected<R: Runtime>(
    app: &AppHandle<R>,
    op_ids: &[String],
    field_changes: Option<&Vec<cache_core::field_changes::RecordFieldChange>>,
    authority_generation: Option<&str>,
) {
    if op_ids.is_empty() {
        return;
    }
    emit_cache_event(
        app,
        OPS_AFFECTED_EVENT,
        OpsAffectedEvent {
            authority_generation: authority_generation.map(str::to_owned),
            field_changes: field_changes.cloned(),
            op_ids: op_ids.to_vec(),
        },
    );
}

/// Notifies webviews of one streamed sync frame like the command it stands
/// in for, so open views update while the stream runs. A sync run carries no
/// webview's authority generation, so its notifications carry none either.
fn emit_sync_publication<R: Runtime>(app: &AppHandle<R>, publication: engine::SyncPublication) {
    match publication {
        engine::SyncPublication::Recorded => {}
        // Like `graphql_cache_hydrate`: an identity reset reaches every
        // subscriber; other pages reach hydration subscribers only.
        engine::SyncPublication::Hydrated {
            write,
            search_changed_buckets,
        } => {
            if write.reset {
                emit_ops_affected(app, &write.affected_ops, None, None);
                if write.revision_advanced {
                    emit_cache_changed(app, &write.revision, true, None);
                }
            } else if write.revision_advanced {
                emit_cache_event(
                    app,
                    CACHE_HYDRATED_EVENT,
                    CacheChangedEvent {
                        authority_generation: None,
                        // No window proofs for sync frames: views refresh.
                        unchanged_views: None,
                        search_changed_buckets: Some(search_changed_buckets),
                        revision: write.revision,
                        reset: None,
                    },
                );
            }
        }
        // Like `graphql_cache_delete_records`.
        engine::SyncPublication::Deleted { affected, .. } => {
            emit_ops_affected(app, &affected.affected_ops, None, None);
            emit_cache_changed(app, &affected.revision, false, None);
        }
        // Like `graphql_cache_calendar_commit`.
        engine::SyncPublication::CalendarCommitted(result) => {
            emit_ops_affected(
                app,
                &result.affected_ops,
                result.field_changes.as_ref(),
                None,
            );
            if result.revision_advanced {
                emit_cache_changed_with_hints(
                    app,
                    &result.revision,
                    result.reset,
                    result.search_changed_buckets.as_ref(),
                    result.unchanged_views.as_ref(),
                    None,
                );
            }
        }
    }
}

fn emit_cache_changed<R: Runtime>(
    app: &AppHandle<R>,
    revision: &str,
    reset: bool,
    authority_generation: Option<&str>,
) {
    emit_cache_changed_with_hints(app, revision, reset, None, None, authority_generation);
}

fn emit_cache_changed_with_hints<R: Runtime>(
    app: &AppHandle<R>,
    revision: &str,
    reset: bool,
    search_changed_buckets: Option<&std::collections::BTreeSet<String>>,
    unchanged_views: Option<&Vec<String>>,
    authority_generation: Option<&str>,
) {
    emit_cache_event(
        app,
        CACHE_CHANGED_EVENT,
        CacheChangedEvent {
            authority_generation: authority_generation.map(str::to_owned),
            unchanged_views: if reset {
                None
            } else {
                unchanged_views.cloned()
            },
            search_changed_buckets: if reset {
                None
            } else {
                search_changed_buckets.cloned()
            },
            revision: revision.to_owned(),
            reset: reset.then_some(true),
        },
    );
}

fn emit_mutation_settled<R: Runtime>(
    app: &AppHandle<R>,
    transaction_id: String,
    mutation_uuid: Option<String>,
    status: &'static str,
    error: Option<String>,
    error_code: Option<String>,
    replacement_transaction_id: Option<String>,
) {
    emit_cache_event(
        app,
        MUTATION_SETTLED_EVENT,
        MutationSettledEvent {
            transaction_id,
            mutation_uuid,
            status,
            error,
            error_code,
            replacement_transaction_id,
        },
    );
}

/// Serialize notifications once, recording their wire size without copying the
/// payload back through a second JSON encoder for diagnostics.
#[tracing::instrument(
    name = "graphql_cache.ipc.notification",
    skip_all,
    fields(event.name = event, graphql_cache.ipc.payload_bytes = tracing::field::Empty)
)]
fn emit_cache_event<R: Runtime, S: Serialize>(app: &AppHandle<R>, event: &str, payload: S) {
    let emit = || -> tauri::Result<()> {
        let json = serde_json::to_string(&payload)?;
        tracing::Span::current().record("graphql_cache.ipc.payload_bytes", json.len());
        app.emit_str(event, json)
    };
    emit()
        .inspect_err(|e| tracing::error!(error=?e, "failed to emit graphql cache event"))
        .ok();
}
