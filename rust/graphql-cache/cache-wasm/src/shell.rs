use async_lock::Mutex;
use cache_core::deps::OpId;
use cache_core::engine::{Engine, ReadResult};
use cache_core::value::EntityKey;
use cache_idb::IdbStorage;
use serde::Serialize;
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
}

#[wasm_bindgen]
pub struct CacheEngine {
    engine: Rc<Mutex<Engine<IdbStorage>>>,
    ops: Rc<RefCell<OpInterner>>,
}

/// Opens (or creates) the cache for `scope`. See
/// [`cache_core::codec::cache_namespace`] for how scope + schema hash +
/// format version determine the underlying database.
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

/// Schema hash baked into this build (namespace diagnostics).
#[wasm_bindgen(js_name = schemaHash)]
pub fn schema_hash() -> String {
    cache_core::meta::SCHEMA_HASH.to_string()
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn err_js(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn parse_variables(
    variables: JsValue,
) -> Result<serde_json::Map<String, serde_json::Value>, JsValue> {
    if variables.is_undefined() || variables.is_null() {
        return Ok(serde_json::Map::new());
    }
    serde_wasm_bindgen::from_value(variables).map_err(err_js)
}

#[wasm_bindgen]
impl CacheEngine {
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
    ) -> js_sys::Promise {
        let engine = self.engine.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let vars = parse_variables(variables)?;
            let op = op_id.map(|name| ops.borrow_mut().intern(&name));
            let mut engine = engine.lock().await;
            let result = engine
                .read_query(op, &query, operation_name.as_deref(), &vars)
                .await
                .map_err(err_js)?;
            to_js(&match result {
                ReadResult::Hit { data } => JsReadResult::Hit { data },
                ReadResult::Miss => JsReadResult::Miss,
            })
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
                changed: result.changed.into_iter().map(|k| k.0).collect(),
                affected_ops: ops.borrow().names(result.affected_ops),
                reset: result.reset,
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
            let keys: Vec<EntityKey> = keys.into_iter().map(EntityKey).collect();
            let mut engine = engine.lock().await;
            let affected = engine.invalidate_keys(keys.iter());
            to_js(&ops.borrow().names(affected))
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
}
