//! Tauri-native host for the normalized GraphQL cache.
//!
//! The webview counterpart of the browser worker glue in
//! `apps/web/src/lib/graphql-cache/`: the engine (`cache-core` over
//! `cache-sqlite`) lives in the Tauri host process behind an async mutex
//! (`Storage` futures are `MaybeSend`, so `Send` on native) — one shared
//! instance across all webviews/windows, never webview storage.
//! Webviews talk to it through the commands in [`commands`] (registered
//! app-level in `src-tauri`, like the bundle updater plugin) and receive
//! change notifications via the [`OPS_AFFECTED_EVENT`] broadcast event,
//! mirroring the worker `ops-affected` push: each webview's `CacheHost`
//! filters op ids by its own client prefix.
//!
//! Design doc: `apps/web/docs/graphql-normalized-cache-plan.md`.

#![deny(missing_docs)]

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime};

pub mod commands;
mod engine;

pub use engine::{
    ClaimedMutationWire, EngineHandle, OptimisticWriteResultWire, ReadResultWire, WriteResultWire,
};

/// Broadcast event carrying [`OpsAffectedEvent`]: operations whose
/// underlying records changed. Emitted to every webview; hosts filter by
/// their own client-id prefix (the origin operation is already excluded by
/// the engine).
pub const OPS_AFFECTED_EVENT: &str = "graphql-cache://ops-affected";

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

struct InitializedCache {
    scope: String,
    handle: EngineHandle,
}

/// Managed state holding the lazily-initialized engine handle. Register
/// with `.manage(CacheState::default())` in the app builder.
#[derive(Default)]
pub struct CacheState(Mutex<Option<InitializedCache>>);

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
