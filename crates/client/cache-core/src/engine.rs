//! The cache engine: ties documents, normalization, the hot tier, storage
//! and dependency tracking together behind the API the hosts (wasm worker /
//! Tauri) expose over RPC.

use crate::denormalize::{DenormalizeError, ReadOutcome, RecordSource, denormalize};
use crate::deps::{DepIndex, OpId};
use crate::document::{Document, DocumentError, OperationKind};
use crate::normalize::{NormalizeError, RecordUpdates, normalize};
use crate::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, MutationRequest,
    NewQueuedMutation, PersistedOptimisticLayer, QueuedMutation, StoredMutation,
};
use crate::store::Storage;
use crate::value::{EntityKey, Record, canonical_json};
use lru::LruCache;
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::num::NonZeroUsize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError<S: std::error::Error + 'static> {
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Normalize(#[from] NormalizeError),
    #[error(transparent)]
    Denormalize(#[from] DenormalizeError),
    #[error("unknown or already-settled optimistic transaction {0}")]
    UnknownTransaction(OptimisticTransactionId),
    #[error("stale claim for optimistic transaction {0}")]
    StaleMutationClaim(OptimisticTransactionId),
    #[error("invalid queued mutation {id}: {detail}")]
    InvalidQueuedMutation {
        id: OptimisticTransactionId,
        detail: String,
    },
    #[error("storage: {0}")]
    Storage(#[source] S),
}

/// Result of a cache read.
#[derive(Debug)]
pub enum ReadResult {
    /// Fully answerable from cache.
    Hit { data: Json },
    /// Not answerable; forward to the network.
    Miss,
}

/// Result of writing a network response.
#[derive(Debug)]
pub struct WriteResult {
    /// Records whose contents changed.
    pub changed: BTreeSet<EntityKey>,
    /// Active operations depending on changed records (host re-executes
    /// these). Excludes the operation that performed the write. After a
    /// `reset` this is *every* active operation except the origin.
    pub affected_ops: BTreeSet<OpId>,
    /// True when the identity witness observed a different user than the one
    /// bound to this cache: all previous state was wiped (silent restart)
    /// before this response was written. Hosts must broadcast this to other
    /// engine instances sharing the same storage.
    pub reset: bool,
}

/// Engine-assigned id of one optimistic mutation transaction. Never reuse
/// host operation keys: identical concurrent mutations share an urql key,
/// but each needs its own layer.
pub type OptimisticTransactionId = MutationId;

/// One queued optimistic mutation's contribution to the cache view. Layers
/// are persisted and ordered by their mutation ids; only the strict queue
/// head can be claimed and settled.
#[derive(Clone)]
struct OptimisticLayer {
    id: OptimisticTransactionId,
    updates: RecordUpdates,
}

/// Reserved storage key holding the identity bound to this cache. The
/// `__meta:` prefix can never collide with entity keys (typenames can't
/// contain `:`).
const IDENTITY_META_KEY: &str = "__meta:identity";
const IDENTITY_FIELD: &str = "userId";

/// Hydration/binding state of the session identity tag for this cache.
#[derive(Debug, Clone, PartialEq, Eq)]
enum IdentityState {
    /// Not yet loaded from storage.
    NotHydrated,
    /// Hydrated: no identity has been bound to this cache yet.
    Missing,
    /// Hydrated: bound to this identity. (Named `Bound` rather than `Some`
    /// to avoid shadowing/confusion with `Option::Some` in matches.)
    Bound(String),
}

/// Default hot-tier capacity (records, not bytes — byte budgets are a
/// hardening-phase refinement).
pub const DEFAULT_HOT_CAPACITY: usize = 10_000;

pub struct Engine<S: Storage> {
    storage: S,
    hot: LruCache<EntityKey, Record>,
    docs: HashMap<String, Document>,
    deps: DepIndex,
    identity: IdentityState,
    /// Ordered optimistic mutation layers hydrated from durable storage.
    optimistic: Vec<OptimisticLayer>,
    optimistic_hydrated: bool,
}

impl<S: Storage> Engine<S> {
    pub fn new(storage: S) -> Self {
        Self::with_capacity(storage, DEFAULT_HOT_CAPACITY)
    }

    pub fn with_capacity(storage: S, hot_capacity: usize) -> Self {
        Engine {
            storage,
            hot: LruCache::new(NonZeroUsize::new(hot_capacity).expect("capacity > 0")),
            docs: HashMap::new(),
            deps: DepIndex::new(),
            identity: IdentityState::NotHydrated,
            optimistic: Vec::new(),
            optimistic_hydrated: false,
        }
    }

    /// Hydrates durable optimistic layers before the first operation. Queue
    /// order is the optimistic composition order.
    async fn hydrate_optimistic(&mut self) -> Result<(), EngineError<S::Error>> {
        if self.optimistic_hydrated {
            return Ok(());
        }
        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        self.optimistic = Self::normalize_queued_layers(&mut self.docs, queued)?;
        self.optimistic_hydrated = true;
        Ok(())
    }

    /// Reloads durable optimistic layers after another engine sharing this
    /// storage changes the queue. Returns operations whose effective view
    /// changed.
    pub async fn refresh_optimistic_queue(&mut self) -> Result<WriteResult, EngineError<S::Error>> {
        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        let replacement = Self::normalize_queued_layers(&mut self.docs, queued)?;
        let candidates: BTreeSet<EntityKey> = self
            .optimistic
            .iter()
            .chain(&replacement)
            .flat_map(|layer| layer.updates.keys().cloned())
            .collect();
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        self.optimistic = replacement;
        self.optimistic_hydrated = true;
        let after = effective_records(&bases, &self.optimistic, &candidates);
        let changed: BTreeSet<EntityKey> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(changed.iter());
        Ok(WriteResult {
            changed,
            affected_ops,
            reset: false,
        })
    }

    fn normalize_queued_layers(
        docs: &mut HashMap<String, Document>,
        queued: Vec<QueuedMutation>,
    ) -> Result<Vec<OptimisticLayer>, EngineError<S::Error>> {
        queued
            .into_iter()
            .map(|queued| {
                let variables: Json = serde_json::from_str(&queued.mutation.request.variables_json)
                    .map_err(|error| EngineError::InvalidQueuedMutation {
                        id: queued.id,
                        detail: format!("invalid variables: {error}"),
                    })?;
                let Json::Object(variables) = variables else {
                    return Err(EngineError::InvalidQueuedMutation {
                        id: queued.id,
                        detail: "variables are not an object".to_string(),
                    });
                };
                let data: Json = serde_json::from_str(&queued.optimistic.optimistic_data_json)
                    .map_err(|error| EngineError::InvalidQueuedMutation {
                        id: queued.id,
                        detail: format!("invalid optimistic response: {error}"),
                    })?;
                let document = Self::document(docs, &queued.mutation.request.query)?;
                let operation =
                    document.operation(queued.mutation.request.operation_name.as_deref())?;
                Ok(OptimisticLayer {
                    id: queued.id,
                    updates: normalize(operation, &variables, &data)?,
                })
            })
            .collect()
    }

    /// The identity binding of this cache, hydrating it from storage on
    /// first use. Never returns [`IdentityState::NotHydrated`].
    async fn bound_identity(&mut self) -> Result<IdentityState, EngineError<S::Error>> {
        if self.identity == IdentityState::NotHydrated {
            let key = EntityKey(IDENTITY_META_KEY.to_string());
            let fetched = self
                .storage
                .get_batch(std::slice::from_ref(&key))
                .await
                .map_err(EngineError::Storage)?;
            let stored = fetched.into_iter().next().flatten().and_then(|record| {
                match record.fields.get(IDENTITY_FIELD) {
                    Some(crate::value::CacheValue::String(s)) => Some(s.clone()),
                    _ => None,
                }
            });
            self.identity = match stored {
                Some(user_id) => IdentityState::Bound(user_id),
                None => IdentityState::Missing,
            };
        }
        Ok(self.identity.clone())
    }

    async fn bind_identity(&mut self, user_id: &str) -> Result<(), EngineError<S::Error>> {
        let mut record = Record::default();
        record.fields.insert(
            IDENTITY_FIELD.to_string(),
            crate::value::CacheValue::String(user_id.to_string()),
        );
        self.storage
            .put_batch(vec![(EntityKey(IDENTITY_META_KEY.to_string()), record)])
            .await
            .map_err(EngineError::Storage)?;
        self.identity = IdentityState::Bound(user_id.to_string());
        Ok(())
    }

    /// Attempts to answer a query from cache. When `op_id` is given the
    /// operation is registered as active with the dependencies it touched
    /// (hit *or* miss — a miss still re-executes when its records change).
    pub async fn read_query(
        &mut self,
        op_id: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
    ) -> Result<ReadResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        if op.kind != OperationKind::Query {
            return Err(EngineError::Document(
                DocumentError::UnsupportedOperationType("mutation (reads are query-only)".into()),
            ));
        }

        // Effective read view = durable base + optimistic layers, composed
        // per key. `composed` holds the merged records for optimistically
        // touched keys and is never promoted into the hot tier — the durable
        // LRU base must stay free of optimistic values.
        let optimistic = merged_optimistic(&self.optimistic);
        let mut composed: HashMap<EntityKey, Record> = HashMap::new();
        for (key, update) in &optimistic {
            if let Some(base) = self.hot.peek(key) {
                let mut merged = base.clone();
                merged.merge(update.clone());
                composed.insert(key.clone(), merged);
            }
        }

        // Durable records fetched from storage this read (pre-merge — safe
        // to promote into the hot tier afterwards).
        let mut fetched_base: HashMap<EntityKey, Record> = HashMap::new();
        let mut known_absent: BTreeSet<EntityKey> = BTreeSet::new();
        let mut deps = BTreeSet::new();

        let outcome = loop {
            deps.clear();
            let source = EngineSource {
                hot: &self.hot,
                fetched: &fetched_base,
                composed: &composed,
            };
            match denormalize(op, variables, &source, &mut deps)? {
                ReadOutcome::Complete(data) => break ReadResult::Hit { data },
                ReadOutcome::Miss { .. } => break ReadResult::Miss,
                ReadOutcome::NeedRecords(missing) => {
                    let to_fetch: Vec<EntityKey> = missing
                        .into_iter()
                        .filter(|k| {
                            !known_absent.contains(k)
                                && !fetched_base.contains_key(k)
                                && !composed.contains_key(k)
                        })
                        .collect();
                    if to_fetch.is_empty() {
                        // Everything missing is genuinely absent → miss.
                        break ReadResult::Miss;
                    }
                    let fetched = self
                        .storage
                        .get_batch(&to_fetch)
                        .await
                        .map_err(EngineError::Storage)?;
                    for (key, record) in to_fetch.into_iter().zip(fetched) {
                        match record {
                            Some(r) => {
                                if let Some(update) = optimistic.get(&key) {
                                    let mut merged = r.clone();
                                    merged.merge(update.clone());
                                    composed.insert(key.clone(), merged);
                                }
                                fetched_base.insert(key, r);
                            }
                            None => {
                                if let Some(update) = optimistic.get(&key) {
                                    // Entity exists only optimistically.
                                    composed.insert(key, update.clone());
                                } else {
                                    known_absent.insert(key);
                                }
                            }
                        }
                    }
                }
            }
        };

        // Promote durable records into the hot tier and refresh recency of
        // everything this operation touched.
        for (key, record) in fetched_base {
            self.hot.put(key, record);
        }
        for key in &deps {
            let _ = self.hot.get(key);
        }
        if let Some(op_id) = op_id {
            self.deps.set_op_deps(op_id, deps);
        }
        Ok(outcome)
    }

    /// Normalizes and stores a network response. Returns changed records and
    /// the affected active operations (excluding `origin_op`).
    ///
    /// `identity` is an opaque session tag extracted by the host (e.g. the
    /// viewer id from the response). The engine knows nothing about its
    /// meaning — only that a write tagged with a different identity than the
    /// one bound to this cache wipes everything before the write proceeds
    /// (silent restart), atomically with this write.
    pub async fn write_query(
        &mut self,
        origin_op: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
        identity: Option<&str>,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let updates = normalize(op, variables, data)?;

        let mut reset = false;
        if let Some(observed) = identity {
            match self.bound_identity().await? {
                IdentityState::NotHydrated => unreachable!("bound_identity hydrates"),
                IdentityState::Missing => self.bind_identity(observed).await?,
                IdentityState::Bound(bound) if bound == observed => {}
                IdentityState::Bound(_) => {
                    self.hot.clear();
                    // A different user's session: in-flight optimistic
                    // mutations belong to the old identity — discard them.
                    self.optimistic.clear();
                    self.optimistic_hydrated = true;
                    self.storage.clear().await.map_err(EngineError::Storage)?;
                    self.bind_identity(observed).await?;
                    reset = true;
                }
            }
        }

        let changed = self.persist_updates(updates).await?;

        let mut affected_ops = if reset {
            // Everything anyone had cached is gone: re-execute all ops.
            self.deps.all_ops()
        } else {
            self.deps.ops_for_keys(changed.iter())
        };
        if let Some(origin) = origin_op {
            affected_ops.remove(&origin);
        }
        Ok(WriteResult {
            changed,
            affected_ops,
            reset,
        })
    }

    /// Merges normalized updates into the hot tier and storage. Returns the
    /// keys whose durable contents actually changed.
    async fn persist_updates(
        &mut self,
        updates: RecordUpdates,
    ) -> Result<BTreeSet<EntityKey>, EngineError<S::Error>> {
        // Load current values (hot tier, then storage) so merges detect real
        // changes. Merges are staged in a plain map, NOT the LRU: a batch
        // larger than the hot capacity would otherwise evict its own
        // records mid-merge and overwrite storage with partial updates.
        let mut staging: HashMap<EntityKey, Record> = HashMap::new();
        let mut missing: Vec<EntityKey> = Vec::new();
        for key in updates.keys() {
            match self.hot.peek(key) {
                Some(record) => {
                    staging.insert(key.clone(), record.clone());
                }
                None => missing.push(key.clone()),
            }
        }
        if !missing.is_empty() {
            let fetched = self
                .storage
                .get_batch(&missing)
                .await
                .map_err(EngineError::Storage)?;
            for (key, record) in missing.into_iter().zip(fetched) {
                if let Some(r) = record {
                    staging.insert(key, r);
                }
            }
        }

        let mut changed = BTreeSet::new();
        let mut to_persist: Vec<(EntityKey, Record)> = Vec::new();
        for (key, update) in updates {
            let merged = match staging.remove(&key) {
                Some(mut existing) => {
                    if existing.merge(update) {
                        changed.insert(key.clone());
                    }
                    existing
                }
                None => {
                    changed.insert(key.clone());
                    update
                }
            };
            // Refresh the hot tier (eviction here is harmless: storage gets
            // the fully merged record below).
            self.hot.put(key.clone(), merged.clone());
            to_persist.push((key, merged));
        }

        // Persist every touched record (idempotent for unchanged ones —
        // keeps storage authoritative even if the hot tier evicted them
        // between loads).
        self.storage
            .put_batch(to_persist)
            .await
            .map_err(EngineError::Storage)?;
        Ok(changed)
    }

    /// Atomically enqueues a mutation together with its optimistic layer.
    /// The layer is durable before it becomes visible or the caller is
    /// allowed to forward the mutation to the network.
    pub async fn begin_optimistic_write(
        &mut self,
        origin_op: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
        created_at_ms: i64,
    ) -> Result<(OptimisticTransactionId, WriteResult), EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let updates = normalize(op, variables, data)?;

        let candidates: BTreeSet<EntityKey> = updates.keys().cloned().collect();
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        let identity = match self.bound_identity().await? {
            IdentityState::Bound(identity) => Some(identity),
            IdentityState::NotHydrated | IdentityState::Missing => None,
        };
        let id = self
            .storage
            .enqueue_mutation(NewQueuedMutation {
                mutation: StoredMutation::new(
                    MutationRequest {
                        query: query.to_string(),
                        operation_name: operation_name.map(str::to_string),
                        variables_json: canonical_json(&Json::Object(variables.clone())),
                        identity,
                    },
                    created_at_ms,
                ),
                optimistic: PersistedOptimisticLayer {
                    optimistic_data_json: canonical_json(data),
                    normalized_updates: updates.clone(),
                },
            })
            .await
            .map_err(EngineError::Storage)?;
        self.optimistic.push(OptimisticLayer { id, updates });

        let after = effective_records(&bases, &self.optimistic, &candidates);
        let changed: BTreeSet<EntityKey> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let mut affected_ops = self.deps.ops_for_keys(changed.iter());
        if let Some(origin) = origin_op {
            affected_ops.remove(&origin);
        }
        Ok((
            id,
            WriteResult {
                changed,
                affected_ops,
                reset: false,
            },
        ))
    }

    /// Claims the oldest runnable mutation. A leased or backed-off head
    /// blocks every later mutation.
    pub async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        self.storage
            .claim_next_mutation(request)
            .await
            .map_err(EngineError::Storage)
    }

    /// Releases a retryable mutation while retaining its optimistic layer.
    pub async fn defer_optimistic_write(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<(), EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        if !self
            .storage
            .defer_mutation(transaction, claim, next_attempt_at_ms, error)
            .await
            .map_err(EngineError::Storage)?
        {
            return Err(EngineError::StaleMutationClaim(transaction));
        }
        Ok(())
    }

    /// Replaces the claimed head's optimistic contribution with the real
    /// network response without flickering through the pre-mutation value.
    /// Real records and queue deletion commit in one storage transaction.
    pub async fn commit_optimistic_write(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let index = self
            .optimistic
            .iter()
            .position(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let updates = normalize(op, variables, data)?;

        let mut candidates: BTreeSet<EntityKey> =
            self.optimistic[index].updates.keys().cloned().collect();
        candidates.extend(updates.keys().cloned());
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        let (durable_changed, entries) = stage_updates(&bases, updates);
        if !self
            .storage
            .complete_mutation(transaction, claim, entries.clone())
            .await
            .map_err(EngineError::Storage)?
        {
            return Err(EngineError::StaleMutationClaim(transaction));
        }

        let mut settled_bases = bases;
        for (key, record) in entries {
            settled_bases.insert(key.clone(), record.clone());
            self.hot.put(key, record);
        }
        self.optimistic.remove(index);
        let after = effective_records(&settled_bases, &self.optimistic, &candidates);
        let visible_changed: BTreeSet<EntityKey> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(visible_changed.iter());
        Ok(WriteResult {
            changed: durable_changed,
            affected_ops,
            reset: false,
        })
    }

    /// Permanently fails the claimed head, atomically removing its queue row
    /// and optimistic layer.
    pub async fn rollback_optimistic_write(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let index = self
            .optimistic
            .iter()
            .position(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let candidates: BTreeSet<EntityKey> =
            self.optimistic[index].updates.keys().cloned().collect();
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        if !self
            .storage
            .discard_mutation(transaction, claim)
            .await
            .map_err(EngineError::Storage)?
        {
            return Err(EngineError::StaleMutationClaim(transaction));
        }
        self.optimistic.remove(index);
        let after = effective_records(&bases, &self.optimistic, &candidates);
        let visible_changed: BTreeSet<EntityKey> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(visible_changed.iter());
        Ok(WriteResult {
            changed: BTreeSet::new(),
            affected_ops,
            reset: false,
        })
    }

    /// Loads current durable records (hot tier, then storage) for `keys`
    /// without touching LRU recency or persisting anything.
    async fn load_bases(
        &mut self,
        keys: &BTreeSet<EntityKey>,
    ) -> Result<HashMap<EntityKey, Record>, EngineError<S::Error>> {
        let mut out = HashMap::new();
        let mut missing: Vec<EntityKey> = Vec::new();
        for key in keys {
            match self.hot.peek(key) {
                Some(record) => {
                    out.insert(key.clone(), record.clone());
                }
                None => missing.push(key.clone()),
            }
        }
        if !missing.is_empty() {
            let fetched = self
                .storage
                .get_batch(&missing)
                .await
                .map_err(EngineError::Storage)?;
            for (key, record) in missing.into_iter().zip(fetched) {
                if let Some(r) = record {
                    out.insert(key, r);
                }
            }
        }
        Ok(out)
    }

    /// Reacts to a reset performed by *another* engine instance sharing the
    /// same storage (cross-tab broadcast): drops all local in-memory state
    /// and returns every local active operation for re-execution.
    pub fn external_reset(&mut self) -> BTreeSet<OpId> {
        self.hot.clear();
        self.docs.clear();
        self.optimistic.clear();
        // Another engine may have rebound the shared storage and changed the
        // durable queue, so both identity and optimism must re-hydrate.
        self.optimistic_hydrated = false;
        self.identity = IdentityState::NotHydrated;
        self.deps.all_ops()
    }

    /// Unregisters an active operation (urql teardown).
    pub fn teardown_operation(&mut self, op_id: OpId) {
        self.deps.remove_op(op_id);
    }

    /// Handles records changed *outside* this engine instance (another tab's
    /// engine in the dedicated-worker fallback topology, or push-driven
    /// invalidation): evicts them from the hot tier so the next read hits
    /// storage, and returns the local active operations that depend on them.
    pub fn invalidate_keys<'k>(
        &mut self,
        keys: impl IntoIterator<Item = &'k EntityKey>,
    ) -> BTreeSet<OpId> {
        let mut affected = BTreeSet::new();
        for key in keys {
            self.hot.pop(key);
            affected.extend(self.deps.ops_for_keys([key]));
        }
        affected
    }

    /// Drops all cached state (logout, schema-hash mismatch), including any
    /// pending optimistic layers.
    pub async fn clear(&mut self) -> Result<(), EngineError<S::Error>> {
        self.hot.clear();
        self.optimistic.clear();
        self.optimistic_hydrated = true;
        self.deps = DepIndex::new();
        // The wipe below removes the binding record too.
        self.identity = IdentityState::Missing;
        self.storage.clear().await.map_err(EngineError::Storage)
    }

    pub fn active_ops(&self) -> usize {
        self.deps.active_ops()
    }

    /// Access to the underlying storage (hosts need it for lifecycle
    /// operations like closing connections before database deletion).
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// Memoized document parse. Takes the map (not `&mut self`) so callers
    /// can keep the returned borrow while using other engine fields.
    fn document<'d>(
        docs: &'d mut HashMap<String, Document>,
        query: &str,
    ) -> Result<&'d Document, DocumentError> {
        use std::collections::hash_map::Entry;
        match docs.entry(query.to_string()) {
            Entry::Occupied(e) => Ok(e.into_mut()),
            Entry::Vacant(e) => Ok(e.insert(Document::parse(query)?)),
        }
    }
}

/// Read view over the durable tiers plus the optimistic composition. Uses
/// `peek` (no recency mutation) — recency is refreshed once per read from
/// the dep set.
struct EngineSource<'a> {
    hot: &'a LruCache<EntityKey, Record>,
    /// Durable records batch-fetched from storage during this read.
    fetched: &'a HashMap<EntityKey, Record>,
    /// Optimistically touched keys: durable base + layers, pre-merged.
    /// Takes precedence over both durable tiers.
    composed: &'a HashMap<EntityKey, Record>,
}

impl RecordSource for EngineSource<'_> {
    fn get(&self, key: &EntityKey) -> Option<&Record> {
        self.composed
            .get(key)
            .or_else(|| self.fetched.get(key))
            .or_else(|| self.hot.peek(key))
    }
}

/// All active optimistic layers' updates merged in creation order (later
/// layers override earlier ones field-by-field).
fn merged_optimistic(layers: &[OptimisticLayer]) -> BTreeMap<EntityKey, Record> {
    let mut out: BTreeMap<EntityKey, Record> = BTreeMap::new();
    for layer in layers {
        for (key, record) in &layer.updates {
            out.entry(key.clone()).or_default().merge(record.clone());
        }
    }
    out
}

/// Merges partial response updates into already-loaded durable bases without
/// mutating the hot tier or storage. The caller can then atomically settle a
/// queued mutation before publishing the staged records in memory.
fn stage_updates(
    bases: &HashMap<EntityKey, Record>,
    updates: RecordUpdates,
) -> (BTreeSet<EntityKey>, Vec<(EntityKey, Record)>) {
    let mut changed = BTreeSet::new();
    let mut entries = Vec::with_capacity(updates.len());
    for (key, update) in updates {
        let merged = match bases.get(&key) {
            Some(existing) => {
                let mut merged = existing.clone();
                if merged.merge(update) {
                    changed.insert(key.clone());
                }
                merged
            }
            None => {
                changed.insert(key.clone());
                update
            }
        };
        entries.push((key, merged));
    }
    (changed, entries)
}

/// Effective visible records for `keys`: durable base + every active layer
/// merged in order. `None` when the key exists nowhere.
fn effective_records(
    bases: &HashMap<EntityKey, Record>,
    layers: &[OptimisticLayer],
    keys: &BTreeSet<EntityKey>,
) -> HashMap<EntityKey, Option<Record>> {
    keys.iter()
        .map(|key| {
            let mut record: Option<Record> = bases.get(key).cloned();
            for layer in layers {
                if let Some(update) = layer.updates.get(key) {
                    record
                        .get_or_insert_with(Record::default)
                        .merge(update.clone());
                }
            }
            (key.clone(), record)
        })
        .collect()
}
