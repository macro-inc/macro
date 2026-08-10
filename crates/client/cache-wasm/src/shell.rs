use async_lock::Mutex;
use cache_core::deps::OpId;
use cache_core::engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome, ReadResult};
use cache_core::entity_resolver::EntityResolver;
use cache_core::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use cache_core::query_inspection::QueryInspection;
use cache_core::queue::{ClaimedMutation, MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::{RecordCursor, RecordSelection};
use cache_core::value::EntityKey;
use cache_idb::IdbStorage;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

/// Interns host-side string operation ids to engine `u64` ids.
#[derive(Default)]
struct OpInterner {
    by_name: HashMap<String, OpId>,
    by_id: HashMap<OpId, String>,
    next: OpId,
}

impl OpInterner {
    fn intern(&mut self, name: &str) -> OpId {
        if let Some(id) = self.by_name.get(name) {
            return *id;
        }
        self.next += 1;
        let id = self.next;
        self.by_name.insert(name.to_string(), id);
        self.by_id.insert(id, name.to_string());
        id
    }

    fn remove(&mut self, name: &str) -> Option<OpId> {
        let id = self.by_name.remove(name)?;
        self.by_id.remove(&id);
        Some(id)
    }

    fn names(&self, ids: impl IntoIterator<Item = OpId>) -> Vec<String> {
        ids.into_iter()
            .filter_map(|id| self.by_id.get(&id).cloned())
            .collect()
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum JsReadResult {
    Hit { data: serde_json::Value },
    Miss,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsWriteResult {
    changed: Vec<String>,
    affected_ops: Vec<String>,
    reset: bool,
    revalidations: Vec<QueryRevalidation>,
}

#[derive(Deserialize)]
struct JsInspectionPathSegment {
    field: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsEnqueueOptimisticMutationResult {
    transaction_id: String,
    changed: Vec<String>,
    affected_ops: Vec<String>,
    reset: bool,
    revalidations: Vec<QueryRevalidation>,
    initial_claim: JsInitialMutationClaim,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum JsInitialMutationClaim {
    Claimed { mutation: JsClaimedMutation },
    NotRunnable,
    Failed { error: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsClaimedMutation {
    transaction_id: String,
    lease_generation: String,
    query: String,
    operation_name: Option<String>,
    variables: serde_json::Value,
    identity: Option<String>,
    attempt_count: u32,
}

impl TryFrom<ClaimedMutation> for JsClaimedMutation {
    type Error = JsValue;

    fn try_from(claimed: ClaimedMutation) -> Result<Self, Self::Error> {
        let request = claimed.queued.mutation.request;
        Ok(Self {
            transaction_id: claimed.queued.id.to_string(),
            lease_generation: claimed.lease_generation.to_string(),
            query: request.query,
            operation_name: request.operation_name,
            variables: serde_json::from_str(&request.variables_json).map_err(err_js)?,
            identity: request.identity,
            attempt_count: claimed.queued.mutation.attempt_count,
        })
    }
}

/// Queue ids and lease generations cross the boundary as strings because JS
/// numbers lose precision past 2^53.
fn parse_u64(value: &str, label: &str) -> Result<u64, JsValue> {
    value
        .parse::<u64>()
        .map_err(|_| err_js(format!("invalid {label} `{value}`")))
}

fn parse_transaction_id(id: &str) -> Result<u64, JsValue> {
    parse_u64(id, "optimistic transaction id")
}

fn parse_timestamp(value: f64, label: &str) -> Result<i64, JsValue> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < i64::MIN as f64
        || value >= i64::MAX as f64
    {
        return Err(err_js(format!("invalid {label} `{value}`")));
    }
    Ok(value as i64)
}

#[wasm_bindgen]
pub struct CacheEngine {
    engine: Rc<Mutex<Engine<IdbStorage>>>,
    ops: Rc<RefCell<OpInterner>>,
}

/// Opens (or creates) the cache for `scope`. The physical database is selected
/// by [`cache_core::codec::cache_database_name`] from `scope` alone; the schema
/// compatibility epoch and format version are record-compatibility inputs.
#[wasm_bindgen(js_name = openCache)]
pub async fn open_cache(scope: String, hot_capacity: Option<u32>) -> Result<CacheEngine, JsError> {
    let storage = IdbStorage::open(&scope)
        .await
        .map_err(|e| JsError::new(&e.to_string()))?;
    let engine = match hot_capacity {
        Some(cap) => Engine::with_capacity(storage, cap as usize),
        None => Engine::new(storage),
    };
    Ok(CacheEngine {
        engine: Rc::new(Mutex::new(engine)),
        ops: Rc::new(RefCell::new(OpInterner::default())),
    })
}

/// Deletes the cache database for `scope` (logout).
#[wasm_bindgen(js_name = destroyCache)]
pub async fn destroy_cache(scope: String) -> Result<(), JsError> {
    IdbStorage::destroy(&scope)
        .await
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Schema hash baked into this build (build diagnostics).
#[wasm_bindgen(js_name = schemaHash)]
pub fn schema_hash() -> String {
    cache_core::meta::SCHEMA_HASH.to_string()
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// All rejections surface as real `Error` objects (consistent
/// `instanceof Error` / `.message` behavior with the `JsError`-returning
/// functions like `openCache`).
fn err_js(e: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&e.to_string()).into()
}

fn parse_variables(
    variables: JsValue,
) -> Result<serde_json::Map<String, serde_json::Value>, JsValue> {
    if variables.is_undefined() || variables.is_null() {
        return Ok(serde_json::Map::new());
    }
    serde_wasm_bindgen::from_value(variables).map_err(err_js)
}

fn parse_record_cursor(cursor: JsValue) -> Result<Option<RecordCursor>, JsValue> {
    if cursor.is_undefined() || cursor.is_null() {
        Ok(None)
    } else {
        serde_wasm_bindgen::from_value(cursor)
            .map(Some)
            .map_err(err_js)
    }
}

fn parse_vec<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<Vec<T>, JsValue> {
    if value.is_undefined() || value.is_null() {
        return Ok(Vec::new());
    }
    serde_wasm_bindgen::from_value(value).map_err(err_js)
}

fn parse_query_inspection(
    query: String,
    operation_name: Option<String>,
    path: JsValue,
    variable_filters: Vec<serde_json::Map<String, serde_json::Value>>,
) -> Result<QueryInspection, JsValue> {
    let path: Vec<JsInspectionPathSegment> =
        serde_wasm_bindgen::from_value(path).map_err(err_js)?;
    Ok(QueryInspection {
        query,
        operation_name,
        path: path.into_iter().map(|segment| segment.field).collect(),
        variable_filters,
    })
}

#[wasm_bindgen]
impl CacheEngine {
    /// Returns the opaque identity bound to this cache, or `null` when no
    /// identity-bearing response has been stored yet.
    #[wasm_bindgen(js_name = boundIdentity)]
    pub fn bound_identity(&self) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            let identity = engine
                .lock()
                .await
                .current_identity()
                .await
                .map_err(err_js)?;
            to_js(&identity)
        })
    }

    /// Attempts a cache read. Resolves to `{kind:"hit",data}` or
    /// `{kind:"miss"}`. When `opId` is given, the operation is registered
    /// as active for dependency-driven re-execution.
    #[wasm_bindgen(js_name = readQuery)]
    pub fn read_query(
        &self,
        op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        entity_resolvers: JsValue,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let vars = parse_variables(variables)?;
            let entity_resolvers: Vec<EntityResolver> = parse_vec(entity_resolvers)?;
            let op = op_id.map(|name| ops.borrow_mut().intern(&name));
            let mut engine = engine.lock().await;
            let result = engine
                .read_query_with_entity_resolvers(
                    op,
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &entity_resolvers,
                )
                .await
                .map_err(err_js)?;
            to_js(&match result {
                ReadResult::Hit { data } => JsReadResult::Hit { data },
                ReadResult::Miss => JsReadResult::Miss,
            })
        })
    }

    /// Projects normalized records through a named GraphQL fragment.
    #[wasm_bindgen(js_name = readRecords)]
    pub fn read_records(
        &self,
        document: String,
        fragment_name: String,
        cursor: JsValue,
        limit: u32,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            let selection = RecordSelection::parse(&document, &fragment_name).map_err(err_js)?;
            let cursor = parse_record_cursor(cursor)?;
            let page = engine
                .lock()
                .await
                .read_records(&selection, cursor.as_ref(), limit as usize)
                .await
                .map_err(err_js)?;
            to_js(&page)
        })
    }

    /// Normalizes and stores a network response. Resolves to
    /// `{changed: string[], affectedOps: string[], reset: boolean}` —
    /// `affectedOps` are the registered operation ids (excluding
    /// `originOpId`) whose data changed. `identity` is an opaque session tag
    /// (extracted by the exchange from the response); a tag mismatching the
    /// cache's bound identity wipes and rebinds atomically with this write.
    #[wasm_bindgen(js_name = writeQuery)]
    pub fn write_query(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        data: JsValue,
        identity: Option<String>,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let vars = parse_variables(variables)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let origin = origin_op_id.map(|name| ops.borrow_mut().intern(&name));
            let mut engine = engine.lock().await;
            let result = engine
                .write_query(
                    origin,
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                    identity.as_deref(),
                )
                .await
                .map_err(err_js)?;
            to_js(&JsWriteResult {
                changed: result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.affected_ops),
                reset: result.reset,
                revalidations: result.revalidations,
            })
        })
    }

    /// Durably queues a mutation and its optimistic response, then attempts
    /// to claim the strict queue head before resolving. Claim failures are
    /// returned as a nested diagnostic outcome because enqueue succeeded.
    #[wasm_bindgen(js_name = enqueueOptimisticMutation)]
    #[allow(clippy::too_many_arguments)]
    pub fn enqueue_optimistic_mutation(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        data: JsValue,
        link_patches: JsValue,
        revalidations: JsValue,
        created_at_ms: f64,
        lease_owner: String,
        now_ms: f64,
        lease_expires_at_ms: f64,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let vars = parse_variables(variables)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let link_patches: Vec<OptimisticLinkPatch> = parse_vec(link_patches)?;
            let revalidations: Vec<QueryRevalidation> = parse_vec(revalidations)?;
            let created_at_ms = parse_timestamp(created_at_ms, "enqueue timestamp")?;
            let claim = MutationClaimRequest {
                owner: lease_owner,
                now_ms: parse_timestamp(now_ms, "claim timestamp")?,
                lease_expires_at_ms: parse_timestamp(
                    lease_expires_at_ms,
                    "lease expiration timestamp",
                )?,
            };
            let origin = origin_op_id.map(|name| ops.borrow_mut().intern(&name));
            let mut engine = engine.lock().await;
            let result = engine
                .enqueue_optimistic_mutation(
                    origin,
                    BeginOptimisticWrite {
                        query: &query,
                        operation_name: operation_name.as_deref(),
                        variables: &vars,
                        data: &data,
                        link_patches: &link_patches,
                        revalidations: &revalidations,
                        created_at_ms,
                    },
                    claim,
                )
                .await
                .map_err(err_js)?;
            let initial_claim = match result.initial_claim {
                InitialClaimOutcome::Claimed(claimed) => JsInitialMutationClaim::Claimed {
                    mutation: JsClaimedMutation::try_from(*claimed)?,
                },
                InitialClaimOutcome::NotRunnable => JsInitialMutationClaim::NotRunnable,
                InitialClaimOutcome::Failed(error) => JsInitialMutationClaim::Failed {
                    error: error.to_string(),
                },
            };
            to_js(&JsEnqueueOptimisticMutationResult {
                transaction_id: result.transaction_id.to_string(),
                changed: result
                    .write_result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.write_result.affected_ops),
                reset: result.write_result.reset,
                revalidations: result.write_result.revalidations,
                initial_claim,
            })
        })
    }

    /// Recovers cached query variables without materializing each variant.
    #[wasm_bindgen(js_name = inspectQueryVariants)]
    pub fn inspect_query_variants(
        &self,
        query: String,
        operation_name: Option<String>,
        path: JsValue,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            let inspection = parse_query_inspection(query, operation_name, path, Vec::new())?;
            let variants = engine
                .lock()
                .await
                .inspect_query_variants(&inspection)
                .await
                .map_err(err_js)?;
            to_js(&variants)
        })
    }

    /// Enumerates and materializes cached variants of one generated query field.
    #[wasm_bindgen(js_name = inspectQuery)]
    pub fn inspect_query(
        &self,
        query: String,
        operation_name: Option<String>,
        path: JsValue,
        variable_filters: JsValue,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            let variable_filters = parse_vec(variable_filters)?;
            let inspection = parse_query_inspection(query, operation_name, path, variable_filters)?;
            let instances = engine
                .lock()
                .await
                .inspect_query(&inspection)
                .await
                .map_err(err_js)?;
            to_js(&instances)
        })
    }

    /// Claims the oldest runnable queued mutation.
    #[wasm_bindgen(js_name = claimNextMutation)]
    pub fn claim_next_mutation(
        &self,
        owner: String,
        now_ms: f64,
        lease_expires_at_ms: f64,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            let request = MutationClaimRequest {
                owner,
                now_ms: parse_timestamp(now_ms, "claim timestamp")?,
                lease_expires_at_ms: parse_timestamp(
                    lease_expires_at_ms,
                    "lease expiration timestamp",
                )?,
            };
            let claimed = engine
                .lock()
                .await
                .claim_next_mutation(request)
                .await
                .map_err(err_js)?;
            to_js(&claimed.map(JsClaimedMutation::try_from).transpose()?)
        })
    }

    /// Retains a retryable mutation and releases its queue lease.
    #[wasm_bindgen(js_name = deferOptimisticWrite)]
    pub fn defer_optimistic_write(
        &self,
        transaction_id: String,
        lease_owner: String,
        lease_generation: String,
        next_attempt_at_ms: f64,
        error: String,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            let transaction = parse_transaction_id(&transaction_id)?;
            let claim = MutationClaimToken {
                owner: lease_owner,
                generation: parse_u64(&lease_generation, "lease generation")?,
            };
            engine
                .lock()
                .await
                .defer_optimistic_write(
                    transaction,
                    claim,
                    parse_timestamp(next_attempt_at_ms, "next attempt timestamp")?,
                    error,
                )
                .await
                .map_err(err_js)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Atomically replaces a claimed optimistic layer with the real network
    /// response and removes it from the durable queue.
    #[wasm_bindgen(js_name = commitOptimisticWrite)]
    pub fn commit_optimistic_write(
        &self,
        transaction_id: String,
        lease_owner: String,
        lease_generation: String,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        data: JsValue,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let transaction = parse_transaction_id(&transaction_id)?;
            let claim = MutationClaimToken {
                owner: lease_owner,
                generation: parse_u64(&lease_generation, "lease generation")?,
            };
            let vars = parse_variables(variables)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let mut engine = engine.lock().await;
            let result = engine
                .commit_optimistic_write(
                    transaction,
                    claim,
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                )
                .await
                .map_err(err_js)?;
            to_js(&JsWriteResult {
                changed: result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.affected_ops),
                reset: result.reset,
                revalidations: result.revalidations,
            })
        })
    }

    /// Permanently fails a claimed mutation and removes its optimistic
    /// contribution.
    #[wasm_bindgen(js_name = rollbackOptimisticWrite)]
    pub fn rollback_optimistic_write(
        &self,
        transaction_id: String,
        lease_owner: String,
        lease_generation: String,
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let transaction = parse_transaction_id(&transaction_id)?;
            let claim = MutationClaimToken {
                owner: lease_owner,
                generation: parse_u64(&lease_generation, "lease generation")?,
            };
            let mut engine = engine.lock().await;
            let result = engine
                .rollback_optimistic_write(transaction, claim)
                .await
                .map_err(err_js)?;
            to_js(&JsWriteResult {
                changed: result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.affected_ops),
                reset: result.reset,
                revalidations: result.revalidations,
            })
        })
    }

    /// Evicts externally-changed records from the hot tier (cross-tab
    /// broadcasts, push invalidation). Resolves to the affected local
    /// operation ids.
    #[wasm_bindgen(js_name = invalidateKeys)]
    pub fn invalidate_keys(&self, keys: Vec<String>) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let keys: Vec<EntityKey<'static>> =
                keys.into_iter().map(|key| EntityKey(key.into())).collect();
            let mut engine = engine.lock().await;
            let affected = engine.invalidate_keys(keys.iter());
            to_js(&ops.borrow().names(affected))
        })
    }

    /// Deletes stale records from memory and IndexedDB after a server-side
    /// mutation and resolves to affected local operation ids.
    #[wasm_bindgen(js_name = deleteKeys)]
    pub fn delete_keys(&self, keys: Vec<String>) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let keys: Vec<EntityKey<'static>> =
                keys.into_iter().map(|key| EntityKey(key.into())).collect();
            let affected = engine
                .lock()
                .await
                .delete_keys(&keys)
                .await
                .map_err(err_js)?;
            to_js(&ops.borrow().names(affected))
        })
    }

    /// Reloads optimistic layers after another engine changes the durable
    /// queue and returns locally affected operations.
    #[wasm_bindgen(js_name = refreshOptimisticQueue)]
    pub fn refresh_optimistic_queue(&self) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let result = engine
                .lock()
                .await
                .refresh_optimistic_queue()
                .await
                .map_err(err_js)?;
            to_js(&JsWriteResult {
                changed: result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.affected_ops),
                reset: result.reset,
                revalidations: result.revalidations,
            })
        })
    }

    /// Reacts to a cache reset performed by another engine instance sharing
    /// the same storage (cross-tab broadcast). Drops local in-memory state
    /// and resolves to every local operation id (all must re-execute).
    #[wasm_bindgen(js_name = externalReset)]
    pub fn external_reset(&self) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let affected = engine.lock().await.external_reset();
            to_js(&ops.borrow().names(affected))
        })
    }

    /// Unregisters an operation (urql teardown).
    #[wasm_bindgen(js_name = teardownOperation)]
    pub fn teardown_operation(&self, op_id: String) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let removed = ops.borrow_mut().remove(&op_id);
            if let Some(id) = removed {
                engine.lock().await.teardown_operation(id);
            }
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Drops all cached state (logout, corruption rebuild).
    pub fn clear(&self) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            engine.lock().await.clear().await.map_err(err_js)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Closes the underlying IndexedDB connection. Call before
    /// [`destroyCache`](destroy_cache) — database deletion blocks while
    /// connections are open. The engine is unusable afterwards.
    pub fn close(&self) -> js_sys::Promise {
        let engine = self.engine.clone();
        future_to_promise(async move {
            engine.lock().await.storage().close();
            Ok(JsValue::UNDEFINED)
        })
    }
}
