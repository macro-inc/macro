use async_lock::Mutex;
use cache_core::codec::{
    CACHE_FORMAT_VERSION, CACHE_SCHEMA_COMPATIBILITY_EPOCH, UNVERSIONED_STORAGE_VERSIONS,
    cache_database_name, legacy_cache_database_name,
};
use cache_core::deps::OpId;
use cache_core::engine::{
    BeginOptimisticWrite, CommitOptimisticWriteResult, DeferOptimisticWriteResult, Engine,
    EngineError, InitialClaimOutcome, NetworkWrite, QueryRegistration, ReadResult,
    RollbackOptimisticWriteResult, WriteResult,
};
use cache_core::entity_resolver::EntityResolver;
use cache_core::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use cache_core::predicate::PredicateQueryResult;
use cache_core::query_inspection::QueryInspection;
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationUpsertKind,
};
use cache_core::record_selection::cache::RecordSelectionCache;
use cache_core::search::SearchRequest;
use cache_core::store::QueueDiagnosticsAvailability;
use cache_core::value::EntityKey;
use cache_turso::{
    PhysicalResetReason, QueuedMutationCount, TursoStorage, TursoStorageCloseOutcome,
    TursoStorageError, TursoStorageOpenOutcome, count_queued_mutations,
};
use predicate_index::RecordKey;
use serde::{Deserialize, Serialize};
use soup_filter_cache_adapter::{
    SoupFilterCompileOutcome, authoritative_projection_mutations,
    compile_current_filter_request as compile_filter_request, dirty_projection_mutations,
    mail::ProjectionError as MailProjectionError, notification_deletion_updates,
    notification_projection_updates, optimistic_notification_updates,
    optimistic_projection_mutations,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use turso_opfs::{OpenResult, OpfsError, OpfsErrorKind, OpfsOwner};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};

mod calendar;
#[cfg(test)]
mod test;
#[cfg(test)]
mod test_storage;

#[cfg(test)]
use test_storage::{BrowserStorage, TestStorageFault};

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CacheOpenOutcome {
    OpenedExisting,
    OpenedNew,
    ResetIncompatible,
    ResetCorrupt,
    ResetStorageUncertain,
}

impl CacheOpenOutcome {
    const fn as_str(self) -> &'static str {
        match self {
            Self::OpenedExisting => "opened-existing",
            Self::OpenedNew => "opened-new",
            Self::ResetIncompatible => "reset-incompatible",
            Self::ResetCorrupt => "reset-corrupt",
            Self::ResetStorageUncertain => "reset-storage-uncertain",
        }
    }
}

impl From<TursoStorageOpenOutcome> for CacheOpenOutcome {
    fn from(outcome: TursoStorageOpenOutcome) -> Self {
        match outcome {
            TursoStorageOpenOutcome::OpenedExisting => Self::OpenedExisting,
            TursoStorageOpenOutcome::OpenedNew => Self::OpenedNew,
        }
    }
}

fn recovery_outcome(reason: PhysicalResetReason) -> CacheOpenOutcome {
    match reason {
        PhysicalResetReason::Compatibility => CacheOpenOutcome::ResetIncompatible,
        PhysicalResetReason::Corruption
        | PhysicalResetReason::Codec
        | PhysicalResetReason::Invariant
        | PhysicalResetReason::Integrity => CacheOpenOutcome::ResetCorrupt,
        PhysicalResetReason::StorageFull
        | PhysicalResetReason::TransactionOutcomeUncertain
        | PhysicalResetReason::Io => CacheOpenOutcome::ResetStorageUncertain,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsWriteContext {
    origin_op_id: Option<String>,
    registration: Option<JsQueryRegistration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsQueryRegistration {
    op_id: String,
    #[serde(default)]
    entity_resolvers: Vec<EntityResolver>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsWriteResult {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    identity_errors: Vec<String>,
    revision: String,
    revision_advanced: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    search_changed_buckets: Option<std::collections::BTreeSet<String>>,
    changed: Vec<String>,
    affected_ops: Vec<String>,
    reset: bool,
    revalidations: Vec<QueryRevalidation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mutation_uuid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsHydrationWriteResult {
    search_changed_buckets: std::collections::BTreeSet<String>,
    revision: String,
    revision_advanced: bool,
    changed: Vec<String>,
    affected_ops: Vec<String>,
    reset: bool,
    revalidations: Vec<QueryRevalidation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mutation_uuid: Option<String>,
    data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct JsInspectionPathSegment {
    field: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsEnqueueOptimisticMutationResult {
    transaction_id: String,
    upsert_kind: JsMutationUpsertKind,
    revision: String,
    revision_advanced: bool,
    changed: Vec<String>,
    affected_ops: Vec<String>,
    reset: bool,
    revalidations: Vec<QueryRevalidation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mutation_uuid: Option<String>,
    initial_claim: JsInitialMutationClaim,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum JsMutationUpsertKind {
    Inserted,
    ReplacedPending { removed_transaction_id: String },
    AppendedAfterActive { active_transaction_id: String },
}

impl From<MutationUpsertKind> for JsMutationUpsertKind {
    fn from(kind: MutationUpsertKind) -> Self {
        match kind {
            MutationUpsertKind::Inserted => Self::Inserted,
            MutationUpsertKind::ReplacedPending { removed_id } => Self::ReplacedPending {
                removed_transaction_id: removed_id.to_string(),
            },
            MutationUpsertKind::AppendedAfterActive { active_id } => Self::AppendedAfterActive {
                active_transaction_id: active_id.to_string(),
            },
        }
    }
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
    client_metadata: Option<serde_json::Value>,
    transaction_id: String,
    uuid: String,
    superseded: bool,
    requires_confirmation: bool,
    lease_generation: String,
    query: String,
    operation_name: Option<String>,
    variables: serde_json::Value,
    identity: Option<String>,
    attempt_count: u32,
    server_failure_count: u32,
}

impl TryFrom<ClaimedMutation> for JsClaimedMutation {
    type Error = JsValue;

    fn try_from(claimed: ClaimedMutation) -> Result<Self, Self::Error> {
        let requires_confirmation = claimed.queued.requires_confirmation();
        let client_metadata = cache_core::queue::decode_optimistic_source(
            &claimed.queued.optimistic.optimistic_data_json,
        )
        .map_err(err_js)?
        .client_metadata;
        let request = claimed.queued.mutation.request;
        Ok(Self {
            client_metadata,
            transaction_id: claimed.queued.id.to_string(),
            uuid: claimed.queued.uuid.to_string(),
            superseded: claimed.queued.superseded,
            requires_confirmation,
            lease_generation: claimed.lease_generation.to_string(),
            query: request.query,
            operation_name: request.operation_name,
            variables: serde_json::from_str(&request.variables_json).map_err(err_js)?,
            identity: request.identity,
            attempt_count: claimed.queued.mutation.attempt_count,
            server_failure_count: claimed.queued.mutation.server_failure_count,
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

#[cfg(not(test))]
type BrowserStorage = TursoStorage;
type BrowserEngine = Engine<BrowserStorage>;

#[cfg(not(test))]
fn wrap_storage(storage: TursoStorage) -> BrowserStorage {
    storage
}

#[cfg(test)]
fn wrap_storage(storage: TursoStorage) -> BrowserStorage {
    BrowserStorage::new(storage)
}

#[cfg(not(test))]
fn unwrap_storage(storage: BrowserStorage) -> TursoStorage {
    storage
}

#[cfg(test)]
fn unwrap_storage(storage: BrowserStorage) -> TursoStorage {
    storage.into_inner()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsEntityFilterRequest {
    filters: serde_json::Value,
    sort_method: String,
    sort_direction: String,
    limit: u16,
    baseline: Option<Vec<JsPredicateBaselineEntry>>,
    mail: Option<soup_filter_cache_adapter::mail::PageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsPredicateBaselineEntry {
    key: String,
    sort_timestamp: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum JsEntityFilterResult {
    Reconciled {
        revision: String,
        keys: Vec<String>,
        #[serde(rename = "retainedKeys")]
        retained_keys: Vec<String>,
        optimistic: bool,
    },
    Complete {
        revision: String,
        keys: Vec<String>,
        optimistic: bool,
    },
    Unsupported,
    Incomplete {
        revision: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsRecordSelectionResult {
    revision: String,
    records: Vec<cache_core::record_selection::SelectedRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsAffectedOperationsResult {
    revision: String,
    affected_ops: Vec<String>,
}

#[derive(Serialize)]
struct JsRevisionResult {
    revision: String,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum JsDeferOptimisticWriteResult {
    Deferred,
    DiscardedSuperseded {
        replacement_transaction_id: String,
        #[serde(flatten)]
        result: JsWriteResult,
    },
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum JsCommitOptimisticWriteResult {
    Failed {
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        replacement_transaction_id: Option<String>,
        #[serde(flatten)]
        result: JsWriteResult,
    },
    Committed {
        #[serde(flatten)]
        result: JsWriteResult,
    },
    CommittedSuperseded {
        replacement_transaction_id: String,
        #[serde(flatten)]
        result: JsWriteResult,
    },
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum JsRollbackOptimisticWriteResult {
    RolledBack {
        #[serde(flatten)]
        result: JsWriteResult,
    },
    DiscardedSuperseded {
        replacement_transaction_id: String,
        #[serde(flatten)]
        result: JsWriteResult,
    },
}

fn js_write_result(result: WriteResult, ops: &OpInterner) -> JsWriteResult {
    JsWriteResult {
        identity_errors: result.identity_errors,
        revision: result.revision.to_string(),
        revision_advanced: result.revision_advanced,
        search_changed_buckets: result.search_changed_buckets,
        changed: result
            .changed
            .into_iter()
            .map(|key| key.0.into_owned())
            .collect(),
        affected_ops: ops.names(result.affected_ops),
        reset: result.reset,
        revalidations: result.revalidations,
        mutation_uuid: result.mutation_uuid,
    }
}

struct CacheState {
    selections: RecordSelectionCache,
    engine: Option<BrowserEngine>,
    mail_generation: String,
    scope: String,
    hot_capacity: Option<u32>,
    reset_required: bool,
}

impl CacheState {
    fn ensure_callable(&self) -> Result<(), JsValue> {
        if self.reset_required {
            Err(reset_required_js_error())
        } else if self.engine.is_none() {
            Err(closed_js_error())
        } else {
            Ok(())
        }
    }

    fn engine_mut(&mut self) -> Result<&mut BrowserEngine, JsValue> {
        self.ensure_callable()?;
        Ok(self
            .engine
            .as_mut()
            .expect("callable cache state contains an engine"))
    }

    /// Keep stored projection inputs out of writes that will reset the cache.
    /// The engine still owns the identity reset and operation invalidation.
    async fn can_reuse_stored_identity(&mut self, identity: Option<&str>) -> Result<bool, JsValue> {
        let Some(observed) = identity else {
            return Ok(true);
        };
        let result = self.engine_mut()?.current_identity().await;
        let bound = self.engine_result(result)?;
        Ok(bound.as_deref().is_none_or(|bound| bound == observed))
    }

    fn engine_result<T>(
        &mut self,
        result: Result<T, EngineError<TursoStorageError>>,
    ) -> Result<T, JsValue> {
        result.map_err(|error| self.engine_error(error))
    }

    fn mail_projection_error(&mut self, error: MailProjectionError<TursoStorageError>) -> JsValue {
        match error {
            MailProjectionError::Storage(error) => self.engine_error(EngineError::Storage(error)),
            MailProjectionError::Adapter(error) => err_js(error),
        }
    }

    fn engine_error(&mut self, error: EngineError<TursoStorageError>) -> JsValue {
        if engine_error_requires_reset(&error) {
            self.reset_required = true;
            reset_required_js_error()
        } else {
            err_js(error)
        }
    }
}

#[wasm_bindgen]
pub struct CacheEngine {
    state: Rc<Mutex<CacheState>>,
    ops: Rc<RefCell<OpInterner>>,
}

fn database_identity(scope: &str) -> String {
    cache_database_name(scope, cache_turso::STORAGE_SCHEMA_VERSION)
}

/// Whether `identity` names one of this scope's databases that this build does
/// not open and that no newer build could want: the unversioned name once this
/// build's versions have moved past it, or another name for versions no newer
/// than this build's. A newer version belongs to a build that may come back,
/// for example after a rollback, so it is never stale.
fn is_stale_identity(scope: &str, identity: &str) -> bool {
    let unversioned = legacy_cache_database_name(scope);
    let version = if identity == unversioned {
        Some(UNVERSIONED_STORAGE_VERSIONS)
    } else {
        storage_version(&unversioned, identity)
    };
    let own = (
        CACHE_SCHEMA_COMPATIBILITY_EPOCH,
        CACHE_FORMAT_VERSION,
        cache_turso::STORAGE_SCHEMA_VERSION,
    );
    identity != database_identity(scope) && version.is_some_and(|version| version <= own)
}

/// The `(epoch, format, storage)` versions embedded in a scope's database name.
fn storage_version(unversioned: &str, identity: &str) -> Option<(u32, u32, u32)> {
    let mut parts = identity
        .strip_prefix(unversioned)?
        .strip_prefix(":s")?
        .split('.');
    let number = |part: &str| -> Option<u32> {
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let epoch = number(parts.next()?)?;
    let format = number(parts.next()?.strip_prefix('v')?)?;
    let storage = number(parts.next()?.strip_prefix('t')?)?;
    parts.next().is_none().then_some((epoch, format, storage))
}

thread_local! {
    static RUNTIME_SCHEMA: std::cell::RefCell<Option<std::sync::Arc<cache_core::meta::Schema>>> = const { std::cell::RefCell::new(None) };
}

/// Installs immutable bundle metadata once per worker, before opening its engine.
#[wasm_bindgen(js_name = configureCacheSchema)]
pub fn configure_cache_schema(schema_json: &str) -> Result<(), JsValue> {
    let schema = cache_core::meta::Schema::from_json(schema_json).map_err(err_js)?;
    RUNTIME_SCHEMA.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some(existing) = slot.as_ref() {
            if existing.hash() != schema.hash() {
                return Err(err_js("schema changed within a running cache worker"));
            }
        } else {
            *slot = Some(schema);
        }
        Ok(())
    })
}

fn build_engine(storage: TursoStorage, hot_capacity: Option<u32>) -> BrowserEngine {
    let storage = wrap_storage(storage);
    let schema = RUNTIME_SCHEMA.with(|slot| {
        slot.borrow_mut()
            .get_or_insert_with(cache_core::meta::bundled_schema)
            .clone()
    });
    Engine::with_schema(
        storage,
        hot_capacity.map_or(cache_core::engine::DEFAULT_HOT_CAPACITY, |c| c as usize),
        schema,
    )
}

fn validate_hot_capacity(hot_capacity: Option<u32>) -> Result<(), JsValue> {
    if hot_capacity == Some(0) {
        Err(err_js("hot capacity must be greater than zero"))
    } else {
        Ok(())
    }
}

async fn open_owner(owner: OpfsOwner) -> Result<OpenResult, JsValue> {
    match owner.open().await {
        Ok(opened) => Ok(opened),
        Err(failure) => {
            let error = storage_err_js(failure.error());
            if let Some(owner) = failure.into_owner() {
                owner.release().await.map_err(err_js)?;
            }
            Err(error)
        }
    }
}

struct OpenedStorage {
    storage: TursoStorage,
    outcome: CacheOpenOutcome,
}

async fn open_storage(scope: &str, owner: OpfsOwner) -> Result<OpenedStorage, JsValue> {
    let (owner, reset_outcome) = match open_owner(owner).await? {
        OpenResult::Ready(session) => {
            let connected = session.connect().map_err(err_js)?;
            match TursoStorage::from_opfs_session_with_outcome(connected, scope) {
                Ok((storage, outcome)) => {
                    return Ok(OpenedStorage {
                        storage,
                        outcome: outcome.into(),
                    });
                }
                Err(failure) => {
                    let error = failure.error();
                    if !error.requires_physical_reset() {
                        let owner = failure.preserve().map_err(err_js)?;
                        owner.release().await.map_err(err_js)?;
                        return Err(err_js(error));
                    }
                    let outcome = recovery_outcome(
                        error
                            .physical_reset_reason()
                            .expect("reset-required error has a reset reason"),
                    );
                    (
                        failure
                            .reset()
                            .await
                            .map_err(|failure| storage_err_js(failure.error()))?,
                        outcome,
                    )
                }
            }
        }
        OpenResult::ResetRequired(session) => (
            session
                .reset()
                .await
                .map_err(|failure| storage_err_js(failure.error()))?,
            CacheOpenOutcome::ResetStorageUncertain,
        ),
    };

    match open_owner(owner).await? {
        OpenResult::Ready(session) => {
            let connected = session.connect().map_err(err_js)?;
            match TursoStorage::from_opfs_session(connected, scope) {
                Ok(storage) => Ok(OpenedStorage {
                    storage,
                    outcome: reset_outcome,
                }),
                Err(failure) => {
                    let reset_required = failure.error().requires_physical_reset();
                    let owner = failure
                        .reset()
                        .await
                        .map_err(|failure| storage_err_js(failure.error()))?;
                    owner.release().await.map_err(err_js)?;
                    Err(if reset_required {
                        reset_required_js_error()
                    } else {
                        err_js("cache storage initialization failed")
                    })
                }
            }
        }
        OpenResult::ResetRequired(session) => {
            let owner = session
                .reset()
                .await
                .map_err(|failure| storage_err_js(failure.error()))?;
            owner.release().await.map_err(err_js)?;
            Err(reset_required_js_error())
        }
    }
}

/// Waits until the caller may touch storage while this owner holds the lock.
/// Holding the lock only proves no other engine uses the files; the browser
/// coordinator must also record that this engine's epoch may change them.
async fn await_storage_grant(
    owner: OpfsOwner,
    grant: &js_sys::Function,
) -> Result<OpfsOwner, JsValue> {
    let granted = match grant.call0(&JsValue::UNDEFINED) {
        Ok(value) => JsFuture::from(js_sys::Promise::resolve(&value)).await,
        Err(error) => Err(error),
    };
    match granted {
        Ok(_) => Ok(owner),
        Err(error) => {
            owner.release().await.map_err(err_js)?;
            Err(error)
        }
    }
}

async fn acquire_storage(
    scope: &str,
    recovery_wipe: bool,
    storage_grant: Option<&js_sys::Function>,
    if_available: bool,
) -> Result<OpenedStorage, JsValue> {
    let identity = database_identity(scope);
    let owner = if if_available {
        OpfsOwner::try_acquire(&identity)
            .await
            .map_err(err_js)?
            .ok_or_else(owner_lock_unavailable_js_error)?
    } else {
        OpfsOwner::acquire(&identity).await.map_err(err_js)?
    };
    let owner = match storage_grant {
        Some(grant) => await_storage_grant(owner, grant).await?,
        None => owner,
    };
    let owner = if recovery_wipe {
        owner
            .recovery_wipe()
            .await
            .map_err(|failure| storage_err_js(failure.error()))?
    } else {
        owner
    };
    let mut opened = open_storage(scope, owner).await?;
    if recovery_wipe {
        opened.outcome = CacheOpenOutcome::ResetStorageUncertain;
    }
    Ok(opened)
}

async fn open_cache_inner(
    scope: String,
    hot_capacity: Option<u32>,
    recovery_wipe: bool,
    storage_grant: Option<js_sys::Function>,
    if_available: bool,
) -> Result<(CacheEngine, CacheOpenOutcome), JsValue> {
    validate_hot_capacity(hot_capacity)?;
    let OpenedStorage { storage, outcome } =
        acquire_storage(&scope, recovery_wipe, storage_grant.as_ref(), if_available).await?;
    Ok((
        CacheEngine {
            state: Rc::new(Mutex::new(CacheState {
                selections: RecordSelectionCache::default(),
                engine: Some(build_engine(storage, hot_capacity)),
                mail_generation: soup_filter_cache_adapter::mail::new_generation(),
                scope,
                hot_capacity,
                reset_required: false,
            })),
            ops: Rc::new(RefCell::new(OpInterner::default())),
        },
        outcome,
    ))
}

fn cache_open_result(engine: CacheEngine, outcome: CacheOpenOutcome) -> Result<JsValue, JsValue> {
    let result = js_sys::Object::new();
    js_sys::Reflect::set(
        &result,
        &JsValue::from_str("engine"),
        &JsValue::from(engine),
    )?;
    js_sys::Reflect::set(
        &result,
        &JsValue::from_str("outcome"),
        &JsValue::from_str(outcome.as_str()),
    )?;
    Ok(result.into())
}

/// Opens (or creates) the cache for `scope` after acquiring its exclusive OPFS
/// owner lock. The physical identity is derived from `scope` alone; disposable
/// incomplete or incompatible files are reset and reopened before returning.
#[wasm_bindgen(js_name = openCache)]
pub async fn open_cache(scope: String, hot_capacity: Option<u32>) -> Result<CacheEngine, JsValue> {
    open_cache_inner(scope, hot_capacity, false, None, false)
        .await
        .map(|(engine, _)| engine)
}

/// Additive open API returning the engine and payload-free recovery outcome.
///
/// When given, `on_owner_lock_acquired` is called once the owner lock is held
/// and before any OPFS access; opening continues after its promise resolves.
/// A rejection releases the lock without touching storage.
///
/// With `if_available`, opening never waits behind another holder of the
/// owner lock: it rejects at once, touching nothing, with an error whose
/// `cacheOwnerLockUnavailable` property is `true`.
///
/// When another context keeps the database files open through the adapter's
/// bounded wait, opening rejects with an error whose `cacheStorageBusy`
/// property is `true`. A plain open has then changed neither file; a recovery
/// wipe may have removed one of them.
#[wasm_bindgen(js_name = openCacheWithOutcome)]
pub async fn open_cache_with_outcome(
    scope: String,
    hot_capacity: Option<u32>,
    on_owner_lock_acquired: Option<js_sys::Function>,
    if_available: Option<bool>,
) -> Result<JsValue, JsValue> {
    let (engine, outcome) = open_cache_inner(
        scope,
        hot_capacity,
        false,
        on_owner_lock_acquired,
        if_available.unwrap_or(false),
    )
    .await?;
    cache_open_result(engine, outcome)
}

/// Acquires the canonical owner once, recovery-wipes before any Turso open,
/// then opens a fresh cache while continuously retaining that same owner lock.
#[wasm_bindgen(js_name = openCacheForRecovery)]
pub async fn open_cache_for_recovery(
    scope: String,
    hot_capacity: Option<u32>,
) -> Result<CacheEngine, JsValue> {
    open_cache_inner(scope, hot_capacity, true, None, false)
        .await
        .map(|(engine, _)| engine)
}

/// Additive recovery-open API returning the engine and coarse wipe outcome.
/// `on_owner_lock_acquired` and `if_available` behave as in
/// [`openCacheWithOutcome`](open_cache_with_outcome); both precede the wipe.
#[wasm_bindgen(js_name = openCacheForRecoveryWithOutcome)]
pub async fn open_cache_for_recovery_with_outcome(
    scope: String,
    hot_capacity: Option<u32>,
    on_owner_lock_acquired: Option<js_sys::Function>,
    if_available: Option<bool>,
) -> Result<JsValue, JsValue> {
    let (engine, outcome) = open_cache_inner(
        scope,
        hot_capacity,
        true,
        on_owner_lock_acquired,
        if_available.unwrap_or(false),
    )
    .await?;
    cache_open_result(engine, outcome)
}

/// Physical database identity this build opens for `scope`; it also names the
/// OPFS files and derives the owner Web Lock name.
#[wasm_bindgen(js_name = cacheDatabaseIdentity)]
pub fn cache_database_identity(scope: String) -> String {
    database_identity(&scope)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StaleDatabaseCleanup {
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    queued_mutations: Option<u64>,
}

/// Deletes one of this scope's databases that an older build left behind (see
/// [`cacheDatabaseIdentity`](cache_database_identity)), unless another context
/// holds its owner lock (`in-use`) or it still queues mutations
/// (`queued-mutations`). Never waits for the lock. A file Turso cannot read,
/// or whose queue cannot be counted, is kept and rejects; the caller should
/// use a disposable worker, because such a failure can poison the
/// worker-local OPFS registry.
#[wasm_bindgen(js_name = removeStaleCacheDatabase)]
pub async fn remove_stale_cache_database(
    scope: String,
    identity: String,
) -> Result<JsValue, JsValue> {
    if !is_stale_identity(&scope, &identity) {
        return Err(err_js("not a stale cache database for this scope"));
    }
    let Some(owner) = OpfsOwner::try_acquire(&identity).await.map_err(err_js)? else {
        return to_js(&StaleDatabaseCleanup {
            outcome: "in-use",
            queued_mutations: None,
        });
    };
    let owner = match open_owner(owner).await? {
        OpenResult::Ready(session) => {
            let connected = session.connect().map_err(err_js)?;
            let counted = count_queued_mutations(&connected);
            let owner = connected
                .try_close()
                .map_err(err_js)?
                .preserve()
                .map_err(err_js)?;
            match counted {
                Ok(QueuedMutationCount::Queued(queued)) if queued > 0 => {
                    owner.release().await.map_err(err_js)?;
                    return to_js(&StaleDatabaseCleanup {
                        outcome: "queued-mutations",
                        queued_mutations: Some(queued),
                    });
                }
                // A queue that cannot be counted may still hold work, so the
                // file is kept and the cleanup rejects as for an unreadable file.
                Err(error) => {
                    owner.release().await.map_err(err_js)?;
                    return Err(err_js(error));
                }
                // An empty queue or no queue holds no work any build could send.
                Ok(_) => owner,
            }
        }
        // Only one of the pair exists, so it never held a complete database.
        OpenResult::ResetRequired(session) => session.reset().await.map_err(err_js)?,
    };
    owner.remove_and_release().await.map_err(err_js)?;
    to_js(&StaleDatabaseCleanup {
        outcome: "removed",
        queued_mutations: None,
    })
}

/// Recovery-wipes and recreates the cache database for `scope` while holding
/// the same exclusive OPFS owner lock used by [`openCache`](open_cache).
#[wasm_bindgen(js_name = destroyCache)]
pub async fn destroy_cache(scope: String) -> Result<(), JsValue> {
    OpfsOwner::acquire(&database_identity(&scope))
        .await
        .map_err(err_js)?
        .recovery_wipe()
        .await
        .map_err(err_js)?
        .release()
        .await
        .map_err(err_js)
}

#[cfg(feature = "browser-test-hooks")]
enum BrowserTestStorageMutation {
    IncompatibleNamespace,
    CorruptQueuePayload,
}

#[cfg(feature = "browser-test-hooks")]
async fn browser_test_mutate_closed_storage(
    scope: String,
    mutation: BrowserTestStorageMutation,
) -> Result<(), JsValue> {
    let owner = OpfsOwner::acquire(&database_identity(&scope))
        .await
        .map_err(err_js)?;
    let session = match open_owner(owner).await? {
        OpenResult::Ready(session) => session,
        OpenResult::ResetRequired(session) => {
            let owner = session.reset().await.map_err(err_js)?;
            owner.release().await.map_err(err_js)?;
            return Err(err_js("browser-test storage was already reset-required"));
        }
    };
    let connected = session.connect().map_err(err_js)?;
    let mut storage = match TursoStorage::from_opfs_session(connected, &scope) {
        Ok(storage) => storage,
        Err(failure) => {
            let owner = failure.reset().await.map_err(err_js)?;
            owner.release().await.map_err(err_js)?;
            return Err(err_js("browser-test storage validation failed"));
        }
    };
    match mutation {
        BrowserTestStorageMutation::IncompatibleNamespace => {
            storage.browser_test_make_namespace_incompatible()
        }
        BrowserTestStorageMutation::CorruptQueuePayload => {
            storage.browser_test_corrupt_queue_payload()
        }
    }
    .map_err(err_js)?;
    match storage.try_close().map_err(err_js)? {
        TursoStorageCloseOutcome::Healthy(closed) => closed
            .preserve()
            .map_err(err_js)?
            .release()
            .await
            .map_err(err_js),
        TursoStorageCloseOutcome::ResetRequired(closed) => {
            let owner = closed.reset().await.map_err(err_js)?;
            owner.release().await.map_err(err_js)?;
            Err(err_js("browser-test mutation unexpectedly required reset"))
        }
    }
}

/// Test-artifact-only incompatible-namespace hook.
#[cfg(feature = "browser-test-hooks")]
#[wasm_bindgen(js_name = browserTestMakeNamespaceIncompatible)]
pub async fn browser_test_make_namespace_incompatible(scope: String) -> Result<(), JsValue> {
    browser_test_mutate_closed_storage(scope, BrowserTestStorageMutation::IncompatibleNamespace)
        .await
}

/// Test-artifact-only corrupt-queue hook.
#[cfg(feature = "browser-test-hooks")]
#[wasm_bindgen(js_name = browserTestCorruptQueuePayload)]
pub async fn browser_test_corrupt_queue_payload(scope: String) -> Result<(), JsValue> {
    browser_test_mutate_closed_storage(scope, BrowserTestStorageMutation::CorruptQueuePayload).await
}

/// Schema hash baked into this build (build diagnostics).
#[wasm_bindgen(js_name = schemaHash)]
pub fn schema_hash() -> String {
    cache_core::meta::SCHEMA_HASH.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheBuildInfo {
    package_version: &'static str,
    schema_hash: &'static str,
    schema_compatibility_epoch: u32,
    format_version: u32,
    storage_schema_version: u32,
}

/// Read-only metadata embedded in this WASM binary, available without opening storage.
/// Recovery fixtures compare both artifacts before invoking any destructive hook.
#[wasm_bindgen(js_name = cacheBuildInfo)]
pub fn cache_build_info() -> Result<JsValue, JsValue> {
    to_js(&CacheBuildInfo {
        package_version: env!("CARGO_PKG_VERSION"),
        schema_hash: cache_core::meta::SCHEMA_HASH,
        schema_compatibility_epoch: cache_core::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH,
        format_version: cache_core::codec::CACHE_FORMAT_VERSION,
        storage_schema_version: cache_turso::STORAGE_SCHEMA_VERSION,
    })
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Read envelopes contain strings and JSON values. Converting the JSON in one
/// call avoids a Wasm/JS crossing for every nested field and array element.
fn read_response_to_js<'a, T: Serialize>(
    response: &T,
    values: impl IntoIterator<Item = &'a serde_json::Value>,
) -> Result<JsValue, JsValue> {
    // Preserve the existing rejection of integer values outside JS's safe
    // range. JSON.parse would otherwise silently round them. Floating-point
    // values already have JS Number semantics and are allowed at any magnitude.
    if values.into_iter().any(has_unsafe_json_integer) {
        return to_js(response);
    }
    let json = serde_json::to_string(response).map_err(err_js)?;
    js_sys::JSON::parse(&json)
}

fn has_unsafe_json_integer(value: &serde_json::Value) -> bool {
    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
    match value {
        serde_json::Value::Number(number) => {
            !number.is_f64()
                && number
                    .as_i64()
                    .is_none_or(|n| !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&n))
        }
        serde_json::Value::Array(values) => values.iter().any(has_unsafe_json_integer),
        serde_json::Value::Object(values) => values.values().any(has_unsafe_json_integer),
        _ => false,
    }
}

const RESET_REQUIRED_MARKER: &str = "cacheStorageResetRequired";
const RESET_REQUIRED_MESSAGE: &str = "cache storage reset required";
const OWNER_LOCK_UNAVAILABLE_MARKER: &str = "cacheOwnerLockUnavailable";
const STORAGE_BUSY_MARKER: &str = "cacheStorageBusy";
const OWNER_LOCK_UNAVAILABLE_MESSAGE: &str = "cache database owner lock is held by another context";

/// All rejections surface as real `Error` objects with consistent
/// `instanceof Error` and `.message` behavior.
fn err_js(error: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}

fn closed_js_error() -> JsValue {
    err_js("cache engine is closed")
}

fn reset_required_js_error() -> JsValue {
    let error = js_sys::Error::new(RESET_REQUIRED_MESSAGE);
    js_sys::Reflect::set(
        error.as_ref(),
        &JsValue::from_str(RESET_REQUIRED_MARKER),
        &JsValue::TRUE,
    )
    .expect("new JavaScript Error accepts the reset marker");
    error.into()
}

/// Converts an OPFS adapter error, marking a path another context kept open
/// for the whole busy wait with a `cacheStorageBusy` property of `true`.
fn storage_err_js(error: &OpfsError) -> JsValue {
    let value = err_js(error);
    if error.kind() == OpfsErrorKind::Busy {
        js_sys::Reflect::set(
            &value,
            &JsValue::from_str(STORAGE_BUSY_MARKER),
            &JsValue::TRUE,
        )
        .expect("new JavaScript Error accepts the busy marker");
    }
    value
}

fn owner_lock_unavailable_js_error() -> JsValue {
    let error = js_sys::Error::new(OWNER_LOCK_UNAVAILABLE_MESSAGE);
    js_sys::Reflect::set(
        error.as_ref(),
        &JsValue::from_str(OWNER_LOCK_UNAVAILABLE_MARKER),
        &JsValue::TRUE,
    )
    .expect("new JavaScript Error accepts the unavailable marker");
    error.into()
}

fn engine_error_requires_reset(error: &EngineError<TursoStorageError>) -> bool {
    matches!(
        error,
        EngineError::Storage(storage_error) if storage_error.requires_physical_reset()
    )
}

fn parse_variables(
    variables: JsValue,
) -> Result<serde_json::Map<String, serde_json::Value>, JsValue> {
    if variables.is_undefined() || variables.is_null() {
        return Ok(serde_json::Map::new());
    }
    serde_wasm_bindgen::from_value(variables).map_err(err_js)
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

async fn close_storage(storage: BrowserStorage, force_reset: bool) -> Result<OpfsOwner, JsValue> {
    match unwrap_storage(storage).try_close().map_err(err_js)? {
        TursoStorageCloseOutcome::Healthy(closed) if force_reset => {
            closed.reset().await.map_err(err_js)
        }
        TursoStorageCloseOutcome::Healthy(closed) => closed.preserve().map_err(err_js),
        TursoStorageCloseOutcome::ResetRequired(closed) => closed.reset().await.map_err(err_js),
    }
}

#[wasm_bindgen]
impl CacheEngine {
    /// Returns payload-free durable mutation queue diagnostics.
    #[wasm_bindgen(js_name = queueDiagnostics)]
    pub fn queue_diagnostics(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            // Observation failures bypass `engine_result`: diagnostics never
            // latch reset-required state or alter the engine lifecycle.
            let diagnostics = state
                .engine_mut()?
                .queue_diagnostics()
                .await
                .map_err(err_js)?;
            let value = js_sys::Object::new();
            let available = diagnostics.availability == QueueDiagnosticsAvailability::Available;
            js_sys::Reflect::set(
                &value,
                &JsValue::from_str("availability"),
                &JsValue::from_str(if available {
                    "available"
                } else {
                    "unavailable"
                }),
            )?;
            js_sys::Reflect::set(
                &value,
                &JsValue::from_str("depth"),
                &if available {
                    JsValue::from_str(&diagnostics.depth.to_string())
                } else {
                    JsValue::NULL
                },
            )?;
            js_sys::Reflect::set(
                &value,
                &JsValue::from_str("oldestCreatedAtMs"),
                &if available {
                    diagnostics
                        .oldest_created_at_ms
                        .map_or(JsValue::NULL, |timestamp| {
                            JsValue::from_str(&timestamp.to_string())
                        })
                } else {
                    JsValue::NULL
                },
            )?;
            Ok(value.into())
        })
    }

    /// Returns the current in-memory cache revision as an unsigned decimal string.
    #[wasm_bindgen(js_name = currentRevision)]
    pub fn current_revision(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let revision = state.engine_mut()?.current_revision();
            Ok(JsValue::from_str(&revision.to_string()))
        })
    }

    /// Returns the durable cache generation, initializing it when absent.
    #[wasm_bindgen(js_name = currentStorageGeneration)]
    pub fn current_storage_generation(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let result = state.engine_mut()?.current_storage_generation().await;
            let generation = state.engine_result(result)?;
            Ok(JsValue::from_str(&generation.to_string()))
        })
    }

    /// Returns the opaque identity bound to this cache, or `null` when no
    /// identity-bearing response has been stored yet.
    #[wasm_bindgen(js_name = boundIdentity)]
    pub fn bound_identity(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let result = state.engine_mut()?.current_identity().await;
            let identity = state.engine_result(result)?;
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
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let vars = parse_variables(variables)?;
            let entity_resolvers: Vec<EntityResolver> = parse_vec(entity_resolvers)?;
            let op = op_id.map(|name| ops.borrow_mut().intern(&name));
            let result = state
                .engine_mut()?
                .read_query_with_entity_resolvers(
                    op,
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &entity_resolvers,
                )
                .await;
            let result = state.engine_result(result)?;
            let response = match result {
                ReadResult::Hit { data } => JsReadResult::Hit { data },
                ReadResult::Miss => JsReadResult::Miss,
            };
            let data = match &response {
                JsReadResult::Hit { data } => Some(data),
                JsReadResult::Miss => None,
            };
            read_response_to_js(&response, data)
        })
    }

    /// Projects explicit normalized entity keys through a named GraphQL
    /// fragment without scanning storage.
    #[wasm_bindgen(js_name = readRecordsByKeys)]
    pub fn read_records_by_keys(
        &self,
        document: String,
        fragment_name: String,
        keys: JsValue,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let schema = state.engine_mut()?.schema_snapshot();
            let selection = state
                .selections
                .get(&schema, document, fragment_name)
                .map_err(err_js)?;
            let keys: Vec<String> = parse_vec(keys)?;
            let keys: Vec<_> = keys.into_iter().map(|key| EntityKey(key.into())).collect();
            let result = state
                .engine_mut()?
                .read_records_by_keys(&selection, &keys)
                .await;
            let records = state.engine_result(result)?;
            let response = JsRecordSelectionResult {
                revision: records.revision.to_string(),
                records: records.value,
            };
            read_response_to_js(
                &response,
                response.records.iter().map(|record| &record.record),
            )
        })
    }

    /// Searches the compact materialized projection. Empty queries use the
    /// indexed recent path; text queries rank the compact catalog without
    /// scanning normalized record blobs.
    pub fn search(&self, request: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request: SearchRequest = serde_wasm_bindgen::from_value(request).map_err(err_js)?;
            let result = state.engine_mut()?.search(&request).await;
            let page = state.engine_result(result)?;
            to_js(&page)
        })
    }

    /// Evaluates one exact current-profile GraphQL Soup filter request.
    #[wasm_bindgen(js_name = entityFilter)]
    pub fn entity_filter(&self, request: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request: JsEntityFilterRequest =
                serde_wasm_bindgen::from_value(request).map_err(err_js)?;
            if let Some(mail) = request.mail {
                let generation = state.mail_generation.clone();
                let result = soup_filter_cache_adapter::mail::page_current(
                    state.engine_mut()?,
                    &generation,
                    request.filters,
                    &request.sort_method,
                    &request.sort_direction,
                    request.limit,
                    mail,
                )
                .await
                .map_err(|error| match error {
                    soup_filter_cache_adapter::mail::PageError::Engine(error) => {
                        state.engine_error(error)
                    }
                    soup_filter_cache_adapter::mail::PageError::Adapter(error) => err_js(error),
                })?;
                return to_js(&result);
            }
            let outcome = compile_filter_request(
                request.filters,
                &request.sort_method,
                &request.sort_direction,
                request.limit,
            )
            .map_err(err_js)?;
            let result = match outcome {
                SoupFilterCompileOutcome::Unsupported => JsEntityFilterResult::Unsupported,
                SoupFilterCompileOutcome::Supported(query) if request.baseline.is_some() => {
                    let baseline = request.baseline.unwrap();
                    if baseline.len()
                        > cache_core::predicate::reconciliation::MAX_RECONCILIATION_BASELINE
                    {
                        return Err(err_js("reconciliation baseline is too large"));
                    }
                    let baseline = baseline
                        .into_iter()
                        .map(|entry| {
                            soup_filter_cache_adapter::reconciliation_baseline_entry(
                                entry.key,
                                &entry.sort_timestamp,
                            )
                        })
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(err_js)?;
                    let result = state
                        .engine_mut()?
                        .reconcile_predicate_index(&query, &baseline)
                        .await;
                    let result = state.engine_result(result)?;
                    JsEntityFilterResult::Reconciled {
                        revision: result.revision.to_string(),
                        keys: result
                            .value
                            .keys
                            .into_iter()
                            .map(|key| key.as_str().to_owned())
                            .collect(),
                        retained_keys: result
                            .value
                            .retained_keys
                            .into_iter()
                            .map(|key| key.as_str().to_owned())
                            .collect(),
                        optimistic: result.value.optimistic,
                    }
                }
                SoupFilterCompileOutcome::Supported(query) => {
                    let result = state.engine_mut()?.query_predicate_index(&query).await;
                    let result = state.engine_result(result)?;
                    let revision = result.revision.to_string();
                    match result.value {
                        PredicateQueryResult::Complete(keys) => JsEntityFilterResult::Complete {
                            revision,
                            keys: keys
                                .into_iter()
                                .map(|key| key.as_str().to_owned())
                                .collect(),
                            optimistic: false,
                        },
                        PredicateQueryResult::Optimistic(keys) => JsEntityFilterResult::Complete {
                            revision,
                            keys: keys
                                .into_iter()
                                .map(|key| key.as_str().to_owned())
                                .collect(),
                            optimistic: true,
                        },
                        PredicateQueryResult::Incomplete => {
                            JsEntityFilterResult::Incomplete { revision }
                        }
                    }
                }
            };
            to_js(&result)
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
        context: JsValue,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        data: JsValue,
        identity: Option<String>,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let context: JsWriteContext =
                serde_wasm_bindgen::from_value(context).map_err(err_js)?;
            let vars = parse_variables(variables)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let origin = context
                .origin_op_id
                .map(|name| ops.borrow_mut().intern(&name));
            let registration = context.registration.map(|registration| {
                let op_id = ops.borrow_mut().intern(&registration.op_id);
                (op_id, registration.entity_resolvers)
            });
            let mut projections = authoritative_projection_mutations(
                &state.engine_mut()?.schema_snapshot(),
                &query,
                operation_name.as_deref(),
                &data,
            )
            .map_err(err_js)?;
            let reuse_stored_identity =
                state.can_reuse_stored_identity(identity.as_deref()).await?;
            if reuse_stored_identity {
                projections.extend(
                    notification_projection_updates(
                        &state.engine_mut()?.schema_snapshot(),
                        state.engine_mut()?.storage(),
                        &query,
                        operation_name.as_deref(),
                        &vars,
                        &data,
                    )
                    .await
                    .map_err(err_js)?,
                );
            }
            projections.extend(
                soup_filter_cache_adapter::mail::projection_updates_for_write(
                    &state.engine_mut()?.schema_snapshot(),
                    state.engine_mut()?.storage(),
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                    reuse_stored_identity,
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            );
            let projections = soup_filter_cache_adapter::properties::augment_authoritative(
                &state.engine_mut()?.schema_snapshot(),
                state.engine_mut()?.storage(),
                &query,
                operation_name.as_deref(),
                &vars,
                &data,
                reuse_stored_identity,
                projections,
            )
            .await
            .map_err(|error| state.mail_projection_error(error))?;
            let result = state
                .engine_mut()?
                .write_query_with_registration_and_projections(
                    origin,
                    registration
                        .as_ref()
                        .map(|(op_id, entity_resolvers)| QueryRegistration {
                            op_id: *op_id,
                            entity_resolvers,
                        }),
                    NetworkWrite {
                        query: &query,
                        operation_name: operation_name.as_deref(),
                        variables: &vars,
                        data: &data,
                        identity: identity.as_deref(),
                    },
                    projections,
                )
                .await;
            let result = state.engine_result(result)?;
            to_js(&js_write_result(result, &ops.borrow()))
        })
    }

    /// Normalizes and stores a query response while returning only fields not
    /// marked `@cacheOnly` in the GraphQL document.
    #[wasm_bindgen(js_name = hydrateQuery)]
    pub fn hydrate_query(
        &self,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        data: JsValue,
        identity: Option<String>,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let variables = parse_variables(variables)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let mut projections = authoritative_projection_mutations(
                &state.engine_mut()?.schema_snapshot(),
                &query,
                operation_name.as_deref(),
                &data,
            )
            .map_err(err_js)?;
            let reuse_stored_identity =
                state.can_reuse_stored_identity(identity.as_deref()).await?;
            if reuse_stored_identity {
                projections.extend(
                    notification_projection_updates(
                        &state.engine_mut()?.schema_snapshot(),
                        state.engine_mut()?.storage(),
                        &query,
                        operation_name.as_deref(),
                        &variables,
                        &data,
                    )
                    .await
                    .map_err(err_js)?,
                );
            }
            projections.extend(
                soup_filter_cache_adapter::mail::projection_updates_for_write(
                    &state.engine_mut()?.schema_snapshot(),
                    state.engine_mut()?.storage(),
                    &query,
                    operation_name.as_deref(),
                    &variables,
                    &data,
                    reuse_stored_identity,
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            );
            let projections = soup_filter_cache_adapter::properties::augment_authoritative(
                &state.engine_mut()?.schema_snapshot(),
                state.engine_mut()?.storage(),
                &query,
                operation_name.as_deref(),
                &variables,
                &data,
                reuse_stored_identity,
                projections,
            )
            .await
            .map_err(|error| state.mail_projection_error(error))?;
            let result = state
                .engine_mut()?
                .hydrate_query_with_projections(
                    &query,
                    operation_name.as_deref(),
                    &variables,
                    &data,
                    identity.as_deref(),
                    projections,
                )
                .await;
            let result = state.engine_result(result)?;
            to_js(&JsHydrationWriteResult {
                search_changed_buckets: result.search_changed_buckets,
                revision: result.write_result.revision.to_string(),
                revision_advanced: result.write_result.revision_advanced,
                changed: result
                    .write_result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.write_result.affected_ops),
                reset: result.write_result.reset,
                revalidations: result.write_result.revalidations,
                mutation_uuid: result.write_result.mutation_uuid,
                data: result.data,
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
        uuid: String,
        query: String,
        operation_name: Option<String>,
        variables: JsValue,
        data: JsValue,
        link_patches: JsValue,
        revalidations: JsValue,
        identity_bindings: JsValue,
        created_at_ms: f64,
        lease_owner: String,
        now_ms: f64,
        lease_expires_at_ms: f64,
        client_metadata: JsValue,
        uncertain_calendar_event_keys: JsValue,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let vars = parse_variables(variables)?;
            let client_metadata: Option<serde_json::Value> =
                serde_wasm_bindgen::from_value(client_metadata).map_err(err_js)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let link_patches: Vec<OptimisticLinkPatch> = parse_vec(link_patches)?;
            let revalidations: Vec<QueryRevalidation> = parse_vec(revalidations)?;
            let identity_bindings: Vec<cache_core::identity::IdentityBinding> =
                parse_vec(identity_bindings)?;
            let uncertain_calendar_event_keys: Vec<EntityKey<'static>> =
                parse_vec(uncertain_calendar_event_keys)?;
            let created_at_ms = parse_timestamp(created_at_ms, "enqueue timestamp")?;
            let mut projection_mutations = optimistic_projection_mutations(&data, created_at_ms);
            projection_mutations.extend(
                optimistic_notification_updates(
                    notification_projection_updates(
                        &state.engine_mut()?.schema_snapshot(),
                        state.engine_mut()?.storage(),
                        &query,
                        operation_name.as_deref(),
                        &vars,
                        &data,
                    )
                    .await
                    .map_err(err_js)?,
                )
                .map_err(err_js)?,
            );
            projection_mutations.extend(soup_filter_cache_adapter::mail::optimistic_updates(
                soup_filter_cache_adapter::mail::projection_updates(
                    &state.engine_mut()?.schema_snapshot(),
                    state.engine_mut()?.storage(),
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            ));
            projection_mutations.extend(
                soup_filter_cache_adapter::mail::draft_optimistic_updates(
                    &state.engine_mut()?.schema_snapshot(),
                    state.engine_mut()?.storage(),
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            );
            let projection_mutations = soup_filter_cache_adapter::properties::augment_optimistic(
                &state.engine_mut()?.schema_snapshot(),
                state.engine_mut()?.storage(),
                &query,
                operation_name.as_deref(),
                &vars,
                &data,
                projection_mutations,
            )
            .await
            .map_err(|error| state.mail_projection_error(error))?;
            let claim = MutationClaimRequest {
                owner: lease_owner,
                now_ms: parse_timestamp(now_ms, "claim timestamp")?,
                lease_expires_at_ms: parse_timestamp(
                    lease_expires_at_ms,
                    "lease expiration timestamp",
                )?,
            };
            let origin = origin_op_id.map(|name| ops.borrow_mut().intern(&name));
            let result = state
                .engine_mut()?
                .enqueue_optimistic_mutation_with_calendar(
                    origin,
                    BeginOptimisticWrite {
                        client_metadata: client_metadata.as_ref(),
                        uuid: &uuid,
                        query: &query,
                        operation_name: operation_name.as_deref(),
                        variables: &vars,
                        data: &data,
                        link_patches: &link_patches,
                        revalidations: &revalidations,
                        created_at_ms,
                        identity_bindings: &identity_bindings,
                    },
                    claim,
                    projection_mutations,
                    uncertain_calendar_event_keys,
                )
                .await;
            let result = state.engine_result(result)?;
            let initial_claim = match result.initial_claim {
                InitialClaimOutcome::Claimed(claimed) => JsInitialMutationClaim::Claimed {
                    mutation: JsClaimedMutation::try_from(*claimed)?,
                },
                InitialClaimOutcome::NotRunnable => JsInitialMutationClaim::NotRunnable,
                InitialClaimOutcome::Failed(error) if engine_error_requires_reset(&error) => {
                    return Err(state.engine_error(error));
                }
                InitialClaimOutcome::Failed(error) => JsInitialMutationClaim::Failed {
                    error: error.to_string(),
                },
            };
            to_js(&JsEnqueueOptimisticMutationResult {
                transaction_id: result.transaction_id.to_string(),
                upsert_kind: result.upsert_kind.into(),
                revision: result.write_result.revision.to_string(),
                revision_advanced: result.write_result.revision_advanced,
                changed: result
                    .write_result
                    .changed
                    .into_iter()
                    .map(|key| key.0.into_owned())
                    .collect(),
                affected_ops: ops.borrow().names(result.write_result.affected_ops),
                reset: result.write_result.reset,
                revalidations: result.write_result.revalidations,
                mutation_uuid: result.write_result.mutation_uuid,
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
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let inspection = parse_query_inspection(query, operation_name, path, Vec::new())?;
            let result = state
                .engine_mut()?
                .inspect_query_variants(&inspection)
                .await;
            let variants = state.engine_result(result)?;
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
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let variable_filters = parse_vec(variable_filters)?;
            let inspection = parse_query_inspection(query, operation_name, path, variable_filters)?;
            let result = state.engine_mut()?.inspect_query(&inspection).await;
            let instances = state.engine_result(result)?;
            to_js(&instances)
        })
    }

    /// Inspects durable mutations without claiming them.
    #[wasm_bindgen(js_name = inspectMutations)]
    pub fn inspect_mutations(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let result = state.engine_mut()?.inspect_mutations().await;
            to_js(&state.engine_result(result)?)
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
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request = MutationClaimRequest {
                owner,
                now_ms: parse_timestamp(now_ms, "claim timestamp")?,
                lease_expires_at_ms: parse_timestamp(
                    lease_expires_at_ms,
                    "lease expiration timestamp",
                )?,
            };
            let result = state.engine_mut()?.claim_next_mutation(request).await;
            let claimed = state.engine_result(result)?;
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
        server_failure: bool,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let transaction = parse_transaction_id(&transaction_id)?;
            let claim = MutationClaimToken {
                owner: lease_owner,
                generation: parse_u64(&lease_generation, "lease generation")?,
            };
            let next_attempt_at_ms = parse_timestamp(next_attempt_at_ms, "next attempt timestamp")?;
            let result = state
                .engine_mut()?
                .defer_optimistic_write(
                    transaction,
                    claim,
                    next_attempt_at_ms,
                    error,
                    server_failure,
                )
                .await;
            let result = state.engine_result(result)?;
            let result = match result {
                DeferOptimisticWriteResult::Deferred => JsDeferOptimisticWriteResult::Deferred,
                DeferOptimisticWriteResult::DiscardedSuperseded(result) => {
                    JsDeferOptimisticWriteResult::DiscardedSuperseded {
                        replacement_transaction_id: result.replacement_transaction_id.to_string(),
                        result: js_write_result(result.write_result, &ops.borrow()),
                    }
                }
            };
            to_js(&result)
        })
    }

    /// Atomically replaces a claimed optimistic layer with the real network
    /// response and removes it from the durable queue.
    #[wasm_bindgen(js_name = commitOptimisticWrite)]
    #[allow(clippy::too_many_arguments)]
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
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let transaction = parse_transaction_id(&transaction_id)?;
            let claim = MutationClaimToken {
                owner: lease_owner,
                generation: parse_u64(&lease_generation, "lease generation")?,
            };
            let vars = parse_variables(variables)?;
            let data: serde_json::Value = serde_wasm_bindgen::from_value(data).map_err(err_js)?;
            let mut projections = authoritative_projection_mutations(
                &state.engine_mut()?.schema_snapshot(),
                &query,
                operation_name.as_deref(),
                &data,
            )
            .map_err(err_js)?;
            projections.extend(
                notification_projection_updates(
                    &state.engine_mut()?.schema_snapshot(),
                    state.engine_mut()?.storage(),
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                )
                .await
                .map_err(err_js)?,
            );
            projections.extend(
                soup_filter_cache_adapter::mail::projection_updates(
                    &state.engine_mut()?.schema_snapshot(),
                    state.engine_mut()?.storage(),
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            );
            let projections = soup_filter_cache_adapter::properties::augment_authoritative(
                &state.engine_mut()?.schema_snapshot(),
                state.engine_mut()?.storage(),
                &query,
                operation_name.as_deref(),
                &vars,
                &data,
                true,
                projections,
            )
            .await
            .map_err(|error| state.mail_projection_error(error))?;
            let result = state
                .engine_mut()?
                .commit_optimistic_write_with_projections_outcome(
                    transaction,
                    claim,
                    &query,
                    operation_name.as_deref(),
                    &vars,
                    &data,
                    projections,
                )
                .await;
            let result = match state.engine_result(result)? {
                CommitOptimisticWriteResult::Failed(result) => {
                    JsCommitOptimisticWriteResult::Failed {
                        error: result.error,
                        replacement_transaction_id: result
                            .replacement_transaction_id
                            .map(|id| id.to_string()),
                        result: js_write_result(result.write_result, &ops.borrow()),
                    }
                }
                CommitOptimisticWriteResult::Committed(result) => {
                    JsCommitOptimisticWriteResult::Committed {
                        result: js_write_result(result, &ops.borrow()),
                    }
                }
                CommitOptimisticWriteResult::CommittedSuperseded(result) => {
                    JsCommitOptimisticWriteResult::CommittedSuperseded {
                        replacement_transaction_id: result.replacement_transaction_id.to_string(),
                        result: js_write_result(result.write_result, &ops.borrow()),
                    }
                }
            };
            to_js(&result)
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
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let transaction = parse_transaction_id(&transaction_id)?;
            let claim = MutationClaimToken {
                owner: lease_owner,
                generation: parse_u64(&lease_generation, "lease generation")?,
            };
            let result = state
                .engine_mut()?
                .rollback_optimistic_write_with_outcome(transaction, claim)
                .await;
            let result = match state.engine_result(result)? {
                RollbackOptimisticWriteResult::RolledBack(result) => {
                    JsRollbackOptimisticWriteResult::RolledBack {
                        result: js_write_result(result, &ops.borrow()),
                    }
                }
                RollbackOptimisticWriteResult::DiscardedSuperseded(result) => {
                    JsRollbackOptimisticWriteResult::DiscardedSuperseded {
                        replacement_transaction_id: result.replacement_transaction_id.to_string(),
                        result: js_write_result(result.write_result, &ops.borrow()),
                    }
                }
            };
            to_js(&result)
        })
    }

    /// Evicts externally-changed records from the hot tier (cross-tab
    /// broadcasts, push invalidation). Resolves to the affected local
    /// operation ids.
    #[wasm_bindgen(js_name = invalidateKeys)]
    pub fn invalidate_keys(&self, keys: Vec<String>) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let mut projections = dirty_projection_mutations(&keys);
            projections.extend(soup_filter_cache_adapter::mail::dirty_updates(&keys));
            projections.extend(
                notification_deletion_updates(state.engine_mut()?.storage(), &keys, true)
                    .await
                    .map_err(err_js)?,
            );
            let keys: Vec<EntityKey<'static>> =
                keys.into_iter().map(|key| EntityKey(key.into())).collect();
            projections.extend(
                soup_filter_cache_adapter::properties::deletion_updates(
                    state.engine_mut()?.storage(),
                    &keys.iter().map(ToString::to_string).collect::<Vec<_>>(),
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            );
            let projections = soup_filter_cache_adapter::properties::current_mutations(projections);
            let result = state
                .engine_mut()?
                .invalidate_keys_with_projections(&keys, projections)
                .await;
            let affected = state.engine_result(result)?;
            to_js(&JsAffectedOperationsResult {
                revision: affected.revision.to_string(),
                affected_ops: ops.borrow().names(affected.value),
            })
        })
    }

    /// Deletes stale records from memory and Turso after a server-side
    /// mutation and resolves to affected local operation ids.
    #[wasm_bindgen(js_name = deleteKeys)]
    pub fn delete_keys(&self, keys: Vec<String>) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let mut projections =
                notification_deletion_updates(state.engine_mut()?.storage(), &keys, false)
                    .await
                    .map_err(err_js)?;
            projections.extend(
                keys.iter()
                    .filter_map(|key| RecordKey::new(key.clone()).ok())
                    .map(cache_core::predicate::ProjectionMutation::Delete),
            );
            let keys: Vec<EntityKey<'static>> =
                keys.into_iter().map(|key| EntityKey(key.into())).collect();
            projections.extend(
                soup_filter_cache_adapter::properties::deletion_updates(
                    state.engine_mut()?.storage(),
                    &keys.iter().map(ToString::to_string).collect::<Vec<_>>(),
                )
                .await
                .map_err(|error| state.mail_projection_error(error))?,
            );
            let projections = soup_filter_cache_adapter::properties::current_mutations(projections);
            let result = state
                .engine_mut()?
                .delete_keys_with_projection_changes(&keys, projections)
                .await;
            let affected = state.engine_result(result)?;
            to_js(&JsAffectedOperationsResult {
                revision: affected.revision.to_string(),
                affected_ops: ops.borrow().names(affected.value),
            })
        })
    }

    /// Reloads optimistic layers after another engine changes the durable
    /// queue and returns locally affected operations.
    #[wasm_bindgen(js_name = refreshOptimisticQueue)]
    pub fn refresh_optimistic_queue(&self) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let result = state.engine_mut()?.refresh_optimistic_queue().await;
            let result = state.engine_result(result)?;
            to_js(&js_write_result(result, &ops.borrow()))
        })
    }

    /// Reacts to a cache reset performed by another engine instance sharing
    /// the same storage (cross-tab broadcast). Drops local in-memory state
    /// and resolves to every local operation id (all must re-execute).
    #[wasm_bindgen(js_name = externalReset)]
    pub fn external_reset(&self) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let result = state.engine_mut()?.external_reset();
            let affected = state.engine_result(result)?;
            to_js(&JsAffectedOperationsResult {
                revision: affected.revision.to_string(),
                affected_ops: ops.borrow().names(affected.value),
            })
        })
    }

    /// Unregisters an operation (urql teardown).
    #[wasm_bindgen(js_name = teardownOperation)]
    pub fn teardown_operation(&self, op_id: String) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let engine = state.engine_mut()?;
            if let Some(id) = ops.borrow_mut().remove(&op_id) {
                engine.teardown_operation(id);
            }
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Drops all cached state, including the durable mutation queue.
    pub fn clear(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let result = state.engine_mut()?.clear().await;
            let revision = state.engine_result(result)?;
            to_js(&JsRevisionResult {
                revision: revision.to_string(),
            })
        })
    }

    /// Physically resets and recreates this instance's OPFS database while
    /// retaining the exclusive owner lock. The instance remains usable after
    /// the fresh engine has been installed.
    #[wasm_bindgen(js_name = physicalReset)]
    pub fn physical_reset(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let engine = state.engine.take().ok_or_else(|| {
                if state.reset_required {
                    err_js("cache engine requires worker replacement")
                } else {
                    closed_js_error()
                }
            })?;
            let scope = state.scope.clone();
            let hot_capacity = state.hot_capacity;
            let owner = match close_storage(engine.into_storage(), true).await {
                Ok(owner) => owner,
                Err(error) => {
                    state.reset_required = true;
                    return Err(error);
                }
            };
            let storage = match open_storage(&scope, owner).await {
                Ok(opened) => opened.storage,
                Err(error) => {
                    state.reset_required = true;
                    return Err(error);
                }
            };
            state.engine = Some(build_engine(storage, hot_capacity));
            state.mail_generation = soup_filter_cache_adapter::mail::new_generation();
            state.reset_required = false;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Consumes the engine, closes Turso and all OPFS handles, then preserves a
    /// healthy database or resets a latched-unhealthy database before releasing
    /// the exclusive owner lock. Every later instance method rejects.
    pub fn close(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let engine = state.engine.take().ok_or_else(|| {
                if state.reset_required {
                    err_js("cache engine requires worker replacement")
                } else {
                    closed_js_error()
                }
            })?;
            let owner = match close_storage(engine.into_storage(), state.reset_required).await {
                Ok(owner) => owner,
                Err(error) => {
                    state.reset_required = true;
                    return Err(error);
                }
            };
            if let Err(error) = owner.release().await {
                state.reset_required = true;
                return Err(err_js(error));
            }
            state.reset_required = false;
            Ok(JsValue::UNDEFINED)
        })
    }
}

#[cfg(test)]
impl CacheEngine {
    async fn arm_storage_fault(&self, fault: TestStorageFault) {
        let state = self.state.lock().await;
        state
            .engine
            .as_ref()
            .expect("test cache contains an engine")
            .storage()
            .arm(fault);
    }
}
