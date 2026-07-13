//! Tauri command handlers — the IPC surface consumed by the webview
//! `CacheHost` (`apps/web/src/lib/graphql-cache/host/tauri-host.ts`).
//!
//! Lives in its own module because `#[tauri::command]` emits a
//! `#[macro_export]` helper macro whose crate-root re-import collides with
//! the function item when the command is defined directly in `lib.rs`.
//!
//! Errors cross the boundary as strings (the host rejects the pending call;
//! the exchange degrades to the network) — same contract as the browser
//! worker's `{ok: false, error}` responses.

use crate::engine::{EngineHandle, OptimisticWriteResultWire, ReadResultWire, WriteResultWire};
use crate::{CacheState, InitializedCache, emit_ops_affected};
use cache_sqlite::SqliteStorage;
use tauri::{AppHandle, Manager, Runtime, State};

type Variables = serde_json::Map<String, serde_json::Value>;

fn engine_handle(state: &State<'_, CacheState>) -> Result<EngineHandle, String> {
    state
        .0
        .lock()
        .map_err(|_| "graphql cache state poisoned".to_string())?
        .as_ref()
        .map(|cache| cache.handle.clone())
        .ok_or_else(|| "graphql cache not initialized (call graphql_cache_init first)".to_string())
}

/// Opens (or creates) the cache for `scope`. Idempotent for the same scope;
/// errors on a scope mismatch (parity with the browser worker `init`). The
/// database lives at `{app_data_dir}/graphql-cache/cache.sqlite`; the
/// namespace check inside `cache-sqlite` (scope + schema hash + format
/// version) wipes and rebuilds on mismatch — the cache is disposable.
#[tauri::command]
pub async fn graphql_cache_init<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    scope: String,
    hot_capacity: Option<u32>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "graphql cache state poisoned".to_string())?;
    if let Some(existing) = guard.as_ref() {
        if existing.scope == scope {
            return Ok(());
        }
        return Err(format!(
            "graphql cache already initialized for scope {}, got {}",
            existing.scope, scope
        ));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("graphql-cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let storage =
        SqliteStorage::open(dir.join("cache.sqlite"), &scope).map_err(|e| e.to_string())?;
    let handle = EngineHandle::spawn(storage, hot_capacity).map_err(|e| e.to_string())?;
    *guard = Some(InitializedCache { scope, handle });
    Ok(())
}

/// Attempts a cache read; registers `op_id` as active when given.
#[tauri::command]
pub async fn graphql_cache_read(
    state: State<'_, CacheState>,
    op_id: Option<String>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
) -> Result<ReadResultWire, String> {
    engine_handle(&state)?
        .read(op_id, query, operation_name, variables.unwrap_or_default())
        .await
}

/// Normalizes and stores a network response; broadcasts affected operations
/// to every webview.
#[tauri::command]
pub async fn graphql_cache_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    origin_op_id: Option<String>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
    identity: Option<String>,
) -> Result<WriteResultWire, String> {
    let result = engine_handle(&state)?
        .write(
            origin_op_id,
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
            identity,
        )
        .await?;
    emit_ops_affected(&app, &result.affected_ops, &result.changed);
    Ok(result)
}

/// Installs an in-memory optimistic layer from a mutation's optimistic
/// response. The one engine is shared by all webviews (SharedWorker
/// semantics), so visible changes are broadcast too.
#[tauri::command]
pub async fn graphql_cache_begin_optimistic_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    origin_op_id: Option<String>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
) -> Result<OptimisticWriteResultWire, String> {
    let result = engine_handle(&state)?
        .begin_optimistic_write(
            origin_op_id,
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
        )
        .await?;
    emit_ops_affected(&app, &result.result.affected_ops, &result.result.changed);
    Ok(result)
}

/// Atomically replaces a pending optimistic layer with the real network
/// response and flushes contiguous settled layers durably.
#[tauri::command]
pub async fn graphql_cache_commit_optimistic_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    transaction_id: String,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
) -> Result<WriteResultWire, String> {
    let result = engine_handle(&state)?
        .commit_optimistic_write(
            transaction_id,
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
        )
        .await?;
    emit_ops_affected(&app, &result.affected_ops, &result.changed);
    Ok(result)
}

/// Drops a pending optimistic layer's contribution (mutation failed).
#[tauri::command]
pub async fn graphql_cache_rollback_optimistic_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    transaction_id: String,
) -> Result<WriteResultWire, String> {
    let result = engine_handle(&state)?
        .rollback_optimistic_write(transaction_id)
        .await?;
    emit_ops_affected(&app, &result.affected_ops, &result.changed);
    Ok(result)
}

/// External invalidation (e.g. websocket push): evicts records and returns
/// (and broadcasts) the affected registered operation ids.
#[tauri::command]
pub async fn graphql_cache_invalidate<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    keys: Vec<String>,
) -> Result<Vec<String>, String> {
    let affected = engine_handle(&state)?.invalidate(keys.clone()).await?;
    emit_ops_affected(&app, &affected, &keys);
    Ok(affected)
}

/// Unregisters an operation (urql teardown).
#[tauri::command]
pub async fn graphql_cache_teardown(
    state: State<'_, CacheState>,
    op_id: String,
) -> Result<(), String> {
    engine_handle(&state)?.teardown(op_id).await
}

/// Wipes all cached state (logout).
#[tauri::command]
pub async fn graphql_cache_clear(state: State<'_, CacheState>) -> Result<(), String> {
    engine_handle(&state)?.clear().await
}
