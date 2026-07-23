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

use crate::engine::{
    ClaimedMutationWire, EngineHandle, OptimisticWriteResultWire, ReadResultWire, WriteResultWire,
};
use crate::{
    CacheState, InitializedCache, emit_cache_changed, emit_mutation_settled, emit_ops_affected,
};
use cache_core::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use cache_core::query_inspection::CachedQueryInstance;
use cache_core::record_selection::{RecordCursor, SelectedRecordPage};
use cache_sqlite::SqliteStorage;
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

type Variables = serde_json::Map<String, serde_json::Value>;

fn parse_record_cursor(cursor: Option<String>) -> Result<Option<RecordCursor>, String> {
    cursor
        .map(|value| serde_json::from_value(serde_json::Value::String(value)))
        .transpose()
        .map_err(|error| error.to_string())
}

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
    let handle = EngineHandle::new(storage, hot_capacity);
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

/// Projects normalized records through a named GraphQL fragment.
#[tauri::command]
pub async fn graphql_cache_read_records(
    state: State<'_, CacheState>,
    document: String,
    fragment_name: String,
    cursor: Option<String>,
    limit: u32,
) -> Result<SelectedRecordPage, String> {
    engine_handle(&state)?
        .read_records(document, fragment_name, parse_record_cursor(cursor)?, limit)
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
    emit_cache_changed(&app);
    Ok(result)
}

/// Durably queues a mutation and its optimistic response. The one engine is
/// shared by all webviews, so visible changes are broadcast too.
#[tauri::command]
pub async fn graphql_cache_begin_optimistic_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    origin_op_id: Option<String>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
    link_patches: Option<Vec<OptimisticLinkPatch>>,
    revalidations: Option<Vec<QueryRevalidation>>,
    created_at_ms: i64,
) -> Result<OptimisticWriteResultWire, String> {
    let result = engine_handle(&state)?
        .begin_optimistic_write(
            origin_op_id,
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
            link_patches.unwrap_or_default(),
            revalidations.unwrap_or_default(),
            created_at_ms,
        )
        .await?;
    emit_ops_affected(&app, &result.result.affected_ops, &result.result.changed);
    emit_cache_changed(&app);
    Ok(result)
}

/// One field-only response-key path segment for query inspection.
#[derive(Debug, Deserialize)]
pub struct InspectionPathSegment {
    /// Generated GraphQL response key (alias when present).
    pub field: String,
}

/// Enumerates cached variants of one generated query field.
#[tauri::command]
pub async fn graphql_cache_inspect_query(
    state: State<'_, CacheState>,
    query: String,
    operation_name: Option<String>,
    path: Vec<InspectionPathSegment>,
) -> Result<Vec<CachedQueryInstance>, String> {
    engine_handle(&state)?
        .inspect_query(
            query,
            operation_name,
            path.into_iter().map(|segment| segment.field).collect(),
        )
        .await
}

/// Claims the oldest runnable queued mutation.
#[tauri::command]
pub async fn graphql_cache_claim_next_mutation(
    state: State<'_, CacheState>,
    owner: String,
    now_ms: i64,
    lease_expires_at_ms: i64,
) -> Result<Option<ClaimedMutationWire>, String> {
    engine_handle(&state)?
        .claim_next_mutation(owner, now_ms, lease_expires_at_ms)
        .await
}

/// Retains a retryable queued mutation and releases its lease.
#[tauri::command]
pub async fn graphql_cache_defer_optimistic_write(
    state: State<'_, CacheState>,
    transaction_id: String,
    lease_owner: String,
    lease_generation: String,
    next_attempt_at_ms: i64,
    error: String,
) -> Result<(), String> {
    engine_handle(&state)?
        .defer_optimistic_write(
            transaction_id,
            lease_owner,
            lease_generation,
            next_attempt_at_ms,
            error,
        )
        .await
}

/// Atomically replaces a claimed optimistic layer with the real response.
#[tauri::command]
pub async fn graphql_cache_commit_optimistic_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    transaction_id: String,
    lease_owner: String,
    lease_generation: String,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
) -> Result<WriteResultWire, String> {
    let settlement_transaction_id = transaction_id.clone();
    let result = engine_handle(&state)?
        .commit_optimistic_write(
            transaction_id,
            lease_owner,
            lease_generation,
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
        )
        .await?;
    emit_ops_affected(&app, &result.affected_ops, &result.changed);
    emit_cache_changed(&app);
    emit_mutation_settled(&app, settlement_transaction_id, "committed", None);
    Ok(result)
}

/// Permanently fails a claimed mutation and drops its optimistic layer.
#[tauri::command]
pub async fn graphql_cache_rollback_optimistic_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    transaction_id: String,
    lease_owner: String,
    lease_generation: String,
    error: String,
) -> Result<WriteResultWire, String> {
    let settlement_transaction_id = transaction_id.clone();
    let result = engine_handle(&state)?
        .rollback_optimistic_write(transaction_id, lease_owner, lease_generation)
        .await?;
    emit_ops_affected(&app, &result.affected_ops, &result.changed);
    emit_cache_changed(&app);
    emit_mutation_settled(
        &app,
        settlement_transaction_id,
        "permanently-failed",
        Some(error),
    );
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
    emit_cache_changed(&app);
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
pub async fn graphql_cache_clear<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
) -> Result<(), String> {
    engine_handle(&state)?.clear().await?;
    emit_cache_changed(&app);
    Ok(())
}
