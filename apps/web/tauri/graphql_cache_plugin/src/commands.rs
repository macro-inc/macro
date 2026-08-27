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
    AffectedOperationsResultWire, ClaimedMutationWire, EngineHandle,
    EnqueueOptimisticMutationResultWire, ReadResultWire, RecordSelectionResultWire,
    WriteRegistration, WriteRequest, WriteResultWire,
};
use crate::{
    CacheState, InitializedCache, emit_cache_changed, emit_mutation_settled, emit_ops_affected,
};
use cache_core::entity_resolver::EntityResolver;
use cache_core::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use cache_core::query_inspection::{CachedQueryInstance, CachedQueryVariant};
use cache_core::search::{SearchPage, SearchRequest};
use cache_turso::TursoFileDatabase;
use serde::{Deserialize, Serialize};
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
/// database lives at `{app_data_dir}/graphql-cache/cache.turso`. Incompatible
/// or uncertain storage is physically replaced before opening.
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
    let database =
        TursoFileDatabase::new(dir.join("cache.turso")).map_err(|error| error.to_string())?;
    let storage = database
        .open_or_reset(&scope)
        .map_err(|error| error.to_string())?;
    let handle = EngineHandle::new(storage, hot_capacity);
    *guard = Some(InitializedCache { scope, handle });
    Ok(())
}

/// Returns the current in-memory cache revision as a decimal string.
#[tauri::command]
pub async fn graphql_cache_current_revision(
    state: State<'_, CacheState>,
) -> Result<String, String> {
    Ok(engine_handle(&state)?.current_revision().await.to_string())
}

/// Attempts a cache read; registers `op_id` as active when given.
#[tauri::command]
pub async fn graphql_cache_read(
    state: State<'_, CacheState>,
    op_id: Option<String>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    entity_resolvers: Option<Vec<EntityResolver>>,
) -> Result<ReadResultWire, String> {
    engine_handle(&state)?
        .read(
            op_id,
            query,
            operation_name,
            variables.unwrap_or_default(),
            entity_resolvers.unwrap_or_default(),
        )
        .await
}

/// Projects explicit normalized entity keys without scanning storage.
#[tauri::command]
pub async fn graphql_cache_read_records_by_keys(
    state: State<'_, CacheState>,
    document: String,
    fragment_name: String,
    keys: Vec<String>,
) -> Result<RecordSelectionResultWire, String> {
    engine_handle(&state)?
        .read_records_by_keys(document, fragment_name, keys)
        .await
}

/// Searches the compact cache projection without scanning normalized records.
#[tauri::command]
pub async fn graphql_cache_search(
    state: State<'_, CacheState>,
    request: SearchRequest,
) -> Result<SearchPage, String> {
    engine_handle(&state)?.search(request).await
}

/// Active-query registration installed by a network write.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRegistrationWire {
    /// Host operation id.
    pub op_id: String,
    /// Synthetic read relations used by the query.
    #[serde(default)]
    pub entity_resolvers: Vec<EntityResolver>,
}

/// Normalizes and stores a network response; broadcasts affected operations
/// to every webview.
#[tauri::command]
pub async fn graphql_cache_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    origin_op_id: Option<String>,
    registration: Option<WriteRegistrationWire>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
    identity: Option<String>,
) -> Result<WriteResultWire, String> {
    let result = engine_handle(&state)?
        .write(WriteRequest {
            origin_op_id,
            registration: registration.map(|registration| WriteRegistration {
                op_id: registration.op_id,
                entity_resolvers: registration.entity_resolvers,
            }),
            query,
            operation_name,
            variables: variables.unwrap_or_default(),
            data,
            identity,
        })
        .await?;
    emit_ops_affected(&app, &result.affected_ops, &result.changed);
    emit_cache_changed(&app, &result.revision);
    Ok(result)
}

/// Result of hydrating a response without returning cache-only fields.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HydrationResultWire {
    /// At least one non-cache-only field was projected.
    Data {
        /// Projected GraphQL response data.
        data: serde_json::Value,
        /// Revision installed by the hydration write.
        revision: String,
    },
    /// Every response field was cache-only.
    Void {
        /// Revision installed by the hydration write.
        revision: String,
    },
}

/// Normalizes and stores a network response, broadcasts affected operations,
/// and returns only fields not marked `@cacheOnly`.
#[tauri::command]
pub async fn graphql_cache_hydrate<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    query: String,
    operation_name: Option<String>,
    variables: Option<Variables>,
    data: serde_json::Value,
    identity: Option<String>,
) -> Result<HydrationResultWire, String> {
    let result = engine_handle(&state)?
        .hydrate_query(
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
            identity,
        )
        .await?;
    emit_ops_affected(
        &app,
        &result.write_result.affected_ops,
        &result.write_result.changed,
    );
    emit_cache_changed(&app, &result.write_result.revision);
    Ok(match result.data {
        Some(data) => HydrationResultWire::Data {
            data,
            revision: result.write_result.revision,
        },
        None => HydrationResultWire::Void {
            revision: result.write_result.revision,
        },
    })
}

/// Durably queues an optimistic mutation and attempts to claim the strict
/// queue head before broadcasting visible changes to every webview.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn graphql_cache_enqueue_optimistic_mutation<R: Runtime>(
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
    owner: String,
    now_ms: i64,
    lease_expires_at_ms: i64,
) -> Result<EnqueueOptimisticMutationResultWire, String> {
    let result = engine_handle(&state)?
        .enqueue_optimistic_mutation(
            origin_op_id,
            query,
            operation_name,
            variables.unwrap_or_default(),
            data,
            link_patches.unwrap_or_default(),
            revalidations.unwrap_or_default(),
            created_at_ms,
            owner,
            now_ms,
            lease_expires_at_ms,
        )
        .await?;
    emit_ops_affected(&app, &result.result.affected_ops, &result.result.changed);
    emit_cache_changed(&app, &result.result.revision);
    Ok(result)
}

/// One field-only response-key path segment for query inspection.
#[derive(Debug, Deserialize)]
pub struct InspectionPathSegment {
    /// Generated GraphQL response key (alias when present).
    pub field: String,
}

/// Recovers cached query variables without materializing each variant.
#[tauri::command]
pub async fn graphql_cache_inspect_query_variants(
    state: State<'_, CacheState>,
    query: String,
    operation_name: Option<String>,
    path: Vec<InspectionPathSegment>,
) -> Result<Vec<CachedQueryVariant>, String> {
    engine_handle(&state)?
        .inspect_query_variants(
            query,
            operation_name,
            path.into_iter().map(|segment| segment.field).collect(),
        )
        .await
}

/// Enumerates and materializes cached variants of one generated query field.
#[tauri::command]
pub async fn graphql_cache_inspect_query(
    state: State<'_, CacheState>,
    query: String,
    operation_name: Option<String>,
    path: Vec<InspectionPathSegment>,
    variable_filters: Option<Vec<serde_json::Map<String, serde_json::Value>>>,
) -> Result<Vec<CachedQueryInstance>, String> {
    engine_handle(&state)?
        .inspect_query(
            query,
            operation_name,
            path.into_iter().map(|segment| segment.field).collect(),
            variable_filters.unwrap_or_default(),
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
    emit_cache_changed(&app, &result.revision);
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
    emit_cache_changed(&app, &result.revision);
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
) -> Result<AffectedOperationsResultWire, String> {
    let affected = engine_handle(&state)?.invalidate(keys.clone()).await?;
    emit_ops_affected(&app, &affected.affected_ops, &keys);
    emit_cache_changed(&app, &affected.revision);
    Ok(affected)
}

/// Deletes stale durable records after a server mutation returns only entity
/// references and broadcasts the affected registered operations.
#[tauri::command]
pub async fn graphql_cache_delete_records<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    keys: Vec<String>,
) -> Result<AffectedOperationsResultWire, String> {
    let affected = engine_handle(&state)?.delete_records(keys.clone()).await?;
    emit_ops_affected(&app, &affected.affected_ops, &keys);
    emit_cache_changed(&app, &affected.revision);
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
) -> Result<String, String> {
    let revision = engine_handle(&state)?.clear().await?.to_string();
    emit_cache_changed(&app, &revision);
    Ok(revision)
}
