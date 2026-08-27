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
//! Design doc: `apps/web/docs/graphql-normalized-cache-plan.md`.

#![deny(missing_docs)]

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime};

pub mod commands;
mod engine;

pub use engine::{
    AffectedOperationsResultWire, ClaimedMutationWire, EngineHandle,
    EnqueueOptimisticMutationResultWire, InitialMutationClaimWire, ReadResultWire,
    RecordSelectionResultWire, WriteResultWire,
};

/// Broadcast event carrying [`OpsAffectedEvent`]: operations whose
/// underlying records changed. Emitted to every webview; hosts filter by
/// their own client-id prefix (the origin operation is already excluded by
/// the engine).
pub const OPS_AFFECTED_EVENT: &str = "graphql-cache://ops-affected";

/// Broadcast event emitted whenever the effective cache view changes.
pub const CACHE_CHANGED_EVENT: &str = "graphql-cache://cache-changed";

/// Broadcast event carrying the final outcome of a queued mutation.
pub const MUTATION_SETTLED_EVENT: &str = "graphql-cache://mutation-settled";

/// Payload of [`OPS_AFFECTED_EVENT`] — mirrors the worker `CachePush`
/// message in `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsAffectedEvent {
    /// Registered operation ids (`"{clientId}:{urqlKey}"`) to re-execute.
    pub op_ids: Vec<String>,
    /// Changed entity keys, for diagnostics/advanced consumers.
    pub keys: Vec<String>,
}

/// Payload of [`CACHE_CHANGED_EVENT`].
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheChangedEvent {
    /// Effective-view revision installed by the logical mutation.
    pub revision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MutationSettledEvent {
    transaction_id: String,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct InitializedCache {
    scope: String,
    handle: EngineHandle,
}

/// Managed state holding the lazily-initialized engine handle. Register
/// with `.manage(CacheState::default())` in the app builder.
#[derive(Default)]
pub struct CacheState(Mutex<Option<InitializedCache>>);

impl CacheState {
    /// Takes the initialized cache and explicitly closes its Turso connection.
    pub fn shutdown(&self) -> Result<(), String> {
        let cache = self
            .0
            .lock()
            .map_err(|_| "graphql cache state poisoned".to_string())?
            .take();
        cache.map_or(Ok(()), |cache| cache.handle.shutdown())
    }
}

fn emit_ops_affected<R: Runtime>(app: &AppHandle<R>, op_ids: &[String], keys: &[String]) {
    if op_ids.is_empty() {
        return;
    }
    app.emit(
        OPS_AFFECTED_EVENT,
        OpsAffectedEvent {
            op_ids: op_ids.to_vec(),
            keys: keys.to_vec(),
        },
    )
    .inspect_err(|e| tracing::error!(error=?e, "failed to emit graphql cache change event"))
    .ok();
}

fn emit_cache_changed<R: Runtime>(app: &AppHandle<R>, revision: &str) {
    app.emit(
        CACHE_CHANGED_EVENT,
        CacheChangedEvent {
            revision: revision.to_owned(),
        },
    )
        .inspect_err(|e| tracing::error!(error=?e, "failed to emit graphql cache change event"))
        .ok();
}

fn emit_mutation_settled<R: Runtime>(
    app: &AppHandle<R>,
    transaction_id: String,
    status: &'static str,
    error: Option<String>,
) {
    app.emit(
        MUTATION_SETTLED_EVENT,
        MutationSettledEvent {
            transaction_id,
            status,
            error,
        },
    )
    .inspect_err(|e| tracing::error!(error=?e, "failed to emit graphql mutation settlement"))
    .ok();
}
