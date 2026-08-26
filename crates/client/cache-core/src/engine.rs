//! The cache engine: ties documents, normalization, the hot tier, storage
//! and dependency tracking together behind the API the hosts (wasm worker /
//! Tauri) expose over RPC.

#[cfg(test)]
mod test;

use crate::denormalize::{
    DenormalizeError, ReadOutcome, RecordSource, denormalize_record,
    denormalize_with_entity_resolvers,
};
use crate::deps::{DepIndex, OpId};
use crate::document::{Document, DocumentError, OperationKind};
use crate::entity_resolver::{EntityResolver, EntityResolverError, EntityResolverLookup};
use crate::link_patch::{
    LinkPatchError, OptimisticLinkPatch, QueryRevalidation, apply_link_patches,
    deduplicate_patches, missing_patch_record,
};
use crate::normalize::{
    DependencyCompleteness, NormalizeError, RecordUpdates, normalize, normalize_with_dependencies,
    project_hydration_response,
};
use crate::predicate::{
    OptimisticShadowReconciliation, PredicateIndexStorage, PredicateQueryResult,
    ProjectionMutation, ProjectionMutationLayer, ProjectionState,
    compose_effective_optimistic_projection, compose_pending_optimistic_projection,
};
use crate::query_inspection::{
    CachedQueryInstance, CachedQueryVariant, OwnerResolution, QueryInspection,
    QueryInspectionError, matches_variable_filters, prepare, recover_variants, resolve_owner,
    selected_result_value,
};
use crate::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, MutationRequest,
    NewQueuedMutation, OptimisticSource, PersistedOptimisticLayer, QueuedMutation, StoredMutation,
    decode_optimistic_source, encode_optimistic_source,
};
use crate::record_selection::{
    MAX_RECORD_SELECTION_KEYS, RecordSelection, RecordSelectionError, SelectedRecord,
};
use crate::revision::{CacheRevision, Revisioned};
use crate::search::{
    SearchCursor, SearchDocument, SearchError, SearchPage, SearchProfile, SearchRequest,
    compare_recent, fuzzy_freshness_score, project_search_documents, validate_search_request,
};
use crate::store::{QueueDiagnostics, Storage};
use crate::value::{EntityKey, Record, canonical_json};
use lru::LruCache;
use predicate_index::{
    OptimisticProjectionMutation, RecordKey as PredicateRecordKey, ValidatedIndexQuery,
};
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
    #[error(transparent)]
    EntityResolver(#[from] EntityResolverError),
    #[error(transparent)]
    LinkPatch(#[from] LinkPatchError),
    #[error(transparent)]
    QueryInspection(#[from] QueryInspectionError),
    #[error(transparent)]
    RecordSelection(#[from] RecordSelectionError),
    #[error(transparent)]
    Search(#[from] SearchError),
    #[error("unknown or already-settled optimistic transaction {0}")]
    UnknownTransaction(OptimisticTransactionId),
    #[error("stale claim for optimistic transaction {0}")]
    StaleMutationClaim(OptimisticTransactionId),
    #[error("invalid queued mutation {id}: {detail}")]
    InvalidQueuedMutation {
        id: OptimisticTransactionId,
        detail: String,
    },
    #[error("invalid optimistic projection: {0}")]
    InvalidOptimisticProjection(String),
    #[error("storage: {0}")]
    Storage(#[source] S),
    #[error("cache revision overflow")]
    RevisionOverflow,
}

/// Result of a cache read.
#[derive(Debug)]
pub enum ReadResult {
    /// Fully answerable from cache.
    Hit { data: Json },
    /// Not answerable; forward to the network.
    Miss,
}

/// Borrowed inputs for one network response write.
#[derive(Debug, Clone, Copy)]
pub struct NetworkWrite<'a> {
    /// GraphQL operation document.
    pub query: &'a str,
    /// Selected operation name.
    pub operation_name: Option<&'a str>,
    /// Resolved operation variables.
    pub variables: &'a serde_json::Map<String, Json>,
    /// GraphQL response data.
    pub data: &'a Json,
    /// Optional opaque session identity witness.
    pub identity: Option<&'a str>,
}

/// An active query whose dependencies should be installed by a network write.
#[derive(Debug, Clone, Copy)]
pub struct QueryRegistration<'a> {
    /// Host-scoped active operation id.
    pub op_id: OpId,
    /// Read-only relations that change which normalized entities the query uses.
    pub entity_resolvers: &'a [EntityResolver],
}

/// Result of writing a network response.
#[derive(Debug)]
pub struct WriteResult {
    /// Revision installed after this logical cache mutation.
    pub revision: CacheRevision,
    /// Records whose contents changed.
    pub changed: BTreeSet<EntityKey<'static>>,
    /// Active operations depending on changed records (host re-executes
    /// these). Excludes the operation that performed the write. After a
    /// `reset` this is *every* active operation except the origin.
    pub affected_ops: BTreeSet<OpId>,
    /// True when the identity witness observed a different user than the one
    /// bound to this cache: all previous state was wiped (silent restart)
    /// before this response was written. Hosts must broadcast this to other
    /// engine instances sharing the same storage.
    pub reset: bool,
    /// Queries that should be revalidated after a successful settlement.
    pub revalidations: Vec<QueryRevalidation>,
}

/// Result of hydrating a query while returning only non-`@cacheOnly` fields.
#[derive(Debug)]
pub struct HydrationWriteResult {
    /// Cache changes used by hosts for invalidation fan-out.
    pub write_result: WriteResult,
    /// Small caller-visible projection, or `None` when every field is cache-only.
    pub data: Option<Json>,
}

/// Outcome of the initial strict-head claim attempted after enqueue.
#[derive(Debug)]
pub enum InitialClaimOutcome<E> {
    /// The strict queue head was runnable and is now durably leased.
    Claimed(Box<ClaimedMutation>),
    /// The strict queue head is leased, deferred, or the queue is empty.
    NotRunnable,
    /// Enqueue succeeded, but attempting to claim the strict head failed.
    Failed(E),
}

/// Result of durably enqueueing an optimistic mutation and attempting its
/// initial strict-head claim.
#[derive(Debug)]
pub struct EnqueueOptimisticMutationResult<E> {
    /// Engine-assigned id of the newly enqueued optimistic mutation.
    pub transaction_id: OptimisticTransactionId,
    /// Visible cache changes caused by the newly published optimistic layer.
    pub write_result: WriteResult,
    /// Outcome of the claim attempt made before hosts publish cache changes.
    pub initial_claim: InitialClaimOutcome<E>,
}

/// Borrowed inputs for atomically beginning one optimistic mutation.
pub struct BeginOptimisticWrite<'a> {
    /// GraphQL mutation document.
    pub query: &'a str,
    /// Selected operation name.
    pub operation_name: Option<&'a str>,
    /// Mutation variables.
    pub variables: &'a serde_json::Map<String, Json>,
    /// Optimistic mutation response.
    pub data: &'a Json,
    /// Ordered constrained relation recipes.
    pub link_patches: &'a [OptimisticLinkPatch],
    /// Revalidations for relevant fields that could not be patched.
    pub revalidations: &'a [QueryRevalidation],
    /// Wall-clock enqueue timestamp.
    pub created_at_ms: i64,
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
    link_patches: Vec<OptimisticLinkPatch>,
    revalidations: Vec<QueryRevalidation>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
}

/// Reserved storage key holding the identity bound to this cache. The
/// `__meta:` prefix can never collide with entity keys (typenames can't
/// contain `:`).
const IDENTITY_META_KEY: &str = "__meta:identity";
const IDENTITY_VALUE_FIELD: &str = "identity";

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
    revision: CacheRevision,
    hot: LruCache<EntityKey<'static>, Record>,
    docs: HashMap<String, Document>,
    deps: DepIndex,
    identity: IdentityState,
    /// Ordered optimistic mutation layers hydrated from durable storage.
    optimistic: Vec<OptimisticLayer>,
    optimistic_hydrated: bool,
    /// Compact durable catalogs are loaded lazily for text search. Empty
    /// queries use the storage index directly and do not populate this map.
    search_catalogs: HashMap<SearchProfile, HashMap<EntityKey<'static>, SearchDocument>>,
}

impl<S: Storage> Engine<S> {
    pub fn new(storage: S) -> Self {
        Self::with_capacity(storage, DEFAULT_HOT_CAPACITY)
    }

    pub fn with_capacity(storage: S, hot_capacity: usize) -> Self {
        Engine {
            storage,
            revision: CacheRevision::ZERO,
            hot: LruCache::new(NonZeroUsize::new(hot_capacity).expect("capacity > 0")),
            docs: HashMap::new(),
            deps: DepIndex::new(),
            identity: IdentityState::NotHydrated,
            optimistic: Vec::new(),
            optimistic_hydrated: false,
            search_catalogs: HashMap::new(),
        }
    }

    /// Returns the current effective-view revision of this engine generation.
    pub fn current_revision(&self) -> CacheRevision {
        self.revision
    }

    fn ensure_revision_can_advance(&self) -> Result<(), EngineError<S::Error>> {
        self.revision
            .checked_successor()
            .map(|_| ())
            .ok_or(EngineError::RevisionOverflow)
    }

    fn advance_revision(&mut self) -> Result<CacheRevision, EngineError<S::Error>> {
        let next = self
            .revision
            .checked_successor()
            .ok_or(EngineError::RevisionOverflow)?;
        self.revision = next;
        Ok(next)
    }

    fn revisioned<T>(&self, value: T) -> Revisioned<T> {
        Revisioned {
            revision: self.revision,
            value,
        }
    }

    /// Hydrates durable optimistic layers before the first operation. Queue
    /// order is the optimistic composition order. Relation recipes are
    /// reconstructed against the durable base and preceding layers.
    async fn hydrate_optimistic(&mut self) -> Result<(), EngineError<S::Error>> {
        if self.optimistic_hydrated {
            return Ok(());
        }
        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        self.optimistic = self.rebuild_queued_layers(queued).await?;
        self.optimistic_hydrated = true;
        Ok(())
    }

    /// Reloads durable optimistic layers after another engine sharing this
    /// storage changes the queue. Returns operations whose effective view
    /// changed.
    pub async fn refresh_optimistic_queue(&mut self) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        let old_candidates = layer_keys(&self.optimistic);
        let old_bases = self.load_bases(&old_candidates).await?;
        let before = effective_records(&old_bases, &self.optimistic, &old_candidates);
        let replacement = self.rebuild_queued_layers(queued).await?;
        let mut candidates = old_candidates;
        candidates.extend(layer_keys(&replacement));
        let bases = self.load_bases(&candidates).await?;
        let mut before_all = effective_records(&bases, &self.optimistic, &candidates);
        before_all.extend(before);
        let after = effective_records(&bases, &replacement, &candidates);
        self.optimistic = replacement;
        self.optimistic_hydrated = true;
        let changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before_all.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(changed.iter());
        let revision = self.advance_revision()?;
        Ok(WriteResult {
            revision,
            changed,
            affected_ops,
            reset: false,
            revalidations: Vec::new(),
        })
    }

    async fn rebuild_queued_layers(
        &mut self,
        queued: Vec<QueuedMutation>,
    ) -> Result<Vec<OptimisticLayer>, EngineError<S::Error>> {
        let mut layers = Vec::with_capacity(queued.len());
        for queued in queued {
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
            let source = decode_optimistic_source(&queued.optimistic.optimistic_data_json)
                .map_err(|detail| EngineError::InvalidQueuedMutation {
                    id: queued.id,
                    detail: format!("invalid optimistic response: {detail}"),
                })?;
            let document = Self::document(&mut self.docs, &queued.mutation.request.query)?;
            let operation =
                document.operation(queued.mutation.request.operation_name.as_deref())?;
            let mut updates = normalize(operation, &variables, &source.mutation_data)?;
            let patches = deduplicate_patches(&source.link_patches).map_err(|error| {
                EngineError::InvalidQueuedMutation {
                    id: queued.id,
                    detail: error.to_string(),
                }
            })?;
            let candidates: BTreeSet<EntityKey<'static>> = updates.keys().cloned().collect();
            let (candidates, bases) = self
                .load_link_patch_bases(candidates, &layers, &updates, &patches)
                .await?;
            let composed = effective_records(&bases, &layers, &candidates);
            let mut effective = present_records(composed);
            merge_updates_into_effective(&mut effective, &updates);
            // Missing query fields after a format wipe are intentionally not
            // recreated from stale recipes during hydration.
            apply_link_patches(&mut effective, &mut updates, &patches, true)?;
            let revalidations = deduplicate_revalidations(
                source.revalidations.iter().cloned().chain(
                    source
                        .link_patches
                        .iter()
                        .map(OptimisticLinkPatch::revalidation),
                ),
            );
            layers.push(OptimisticLayer {
                id: queued.id,
                updates,
                link_patches: patches,
                revalidations,
                projection_mutations: source.projection_mutations,
            });
        }
        Ok(layers)
    }

    /// The identity binding of this cache, hydrating it from storage on
    /// first use. Never returns [`IdentityState::NotHydrated`].
    async fn bound_identity(&mut self) -> Result<IdentityState, EngineError<S::Error>> {
        if self.identity == IdentityState::NotHydrated {
            let key = EntityKey(IDENTITY_META_KEY.into());
            let fetched = self
                .storage
                .get_batch(std::slice::from_ref(&key))
                .await
                .map_err(EngineError::Storage)?;
            let stored = fetched.into_iter().next().flatten().and_then(|record| {
                match record.fields.get(IDENTITY_VALUE_FIELD) {
                    Some(crate::value::CacheValue::String(s)) => Some(s.clone()),
                    _ => None,
                }
            });
            self.identity = match stored {
                Some(identity) => IdentityState::Bound(identity),
                None => IdentityState::Missing,
            };
        }
        Ok(self.identity.clone())
    }

    /// Returns the opaque identity currently bound to this cache, hydrating
    /// it from persistent storage when necessary.
    pub async fn current_identity(&mut self) -> Result<Option<String>, EngineError<S::Error>> {
        match self.bound_identity().await? {
            IdentityState::NotHydrated => unreachable!("bound_identity hydrates"),
            IdentityState::Missing => Ok(None),
            IdentityState::Bound(identity) => Ok(Some(identity)),
        }
    }

    async fn bind_identity(&mut self, identity: &str) -> Result<(), EngineError<S::Error>> {
        let mut record = Record::default();
        record.fields.insert(
            IDENTITY_VALUE_FIELD.to_string(),
            crate::value::CacheValue::String(identity.to_string()),
        );
        self.storage
            .put_batch(vec![(EntityKey(IDENTITY_META_KEY.into()), record)])
            .await
            .map_err(EngineError::Storage)?;
        self.identity = IdentityState::Bound(identity.to_string());
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
        self.read_query_with_entity_resolvers(op_id, query, operation_name, variables, &[])
            .await
    }

    /// Attempts to answer a query while applying validated read-only entity
    /// relations. Resolver descriptors are request policy and never persisted.
    pub async fn read_query_with_entity_resolvers(
        &mut self,
        op_id: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        entity_resolvers: &[EntityResolver],
    ) -> Result<ReadResult, EngineError<S::Error>> {
        let entity_resolvers = EntityResolverLookup::compile(entity_resolvers)?;
        self.hydrate_optimistic().await?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        if op.kind != OperationKind::Query {
            return Err(EngineError::Document(
                DocumentError::UnsupportedOperationType(format!(
                    "{:?} (cache reads are query-only)",
                    op.kind
                )),
            ));
        }

        // Effective read view = durable base + optimistic layers, composed
        // per key. `composed` holds the merged records for optimistically
        // touched keys and is never promoted into the hot tier — the durable
        // LRU base must stay free of optimistic values.
        let optimistic = merged_optimistic(&self.optimistic);
        let mut composed: HashMap<EntityKey<'static>, Record> = HashMap::new();
        for (key, update) in &optimistic {
            if let Some(base) = self.hot.peek(key) {
                let mut merged = base.clone();
                merged.merge(update.clone());
                composed.insert(key.clone(), merged);
            }
        }

        // Durable records fetched from storage this read (pre-merge — safe
        // to promote into the hot tier afterwards).
        let mut fetched_base: HashMap<EntityKey<'static>, Record> = HashMap::new();
        let mut known_absent: BTreeSet<EntityKey<'static>> = BTreeSet::new();
        let mut deps = BTreeSet::new();

        let outcome = loop {
            deps.clear();
            let source = EngineSource {
                hot: &self.hot,
                fetched: &fetched_base,
                composed: &composed,
            };
            match denormalize_with_entity_resolvers(
                op,
                variables,
                &source,
                &mut deps,
                &entity_resolvers,
            )? {
                ReadOutcome::Complete(data) => break ReadResult::Hit { data },
                ReadOutcome::Miss { .. } => break ReadResult::Miss,
                ReadOutcome::NeedRecords(missing) => {
                    let to_fetch: Vec<EntityKey<'static>> = missing
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

    /// Projects a bounded explicit set of normalized entity keys through a
    /// named fragment without scanning storage. Missing, wrong-type, and
    /// incomplete records are omitted; output preserves first-occurrence key
    /// order.
    pub async fn read_records_by_keys(
        &mut self,
        selection: &RecordSelection,
        keys: &[EntityKey<'static>],
    ) -> Result<Revisioned<Vec<SelectedRecord>>, EngineError<S::Error>> {
        if keys.len() > MAX_RECORD_SELECTION_KEYS {
            return Err(RecordSelectionError::TooManyKeys {
                count: keys.len(),
                max: MAX_RECORD_SELECTION_KEYS,
            }
            .into());
        }
        if keys.iter().any(|key| {
            key.as_ref().len() > 1024
                || key.as_ref().split_once(':').is_none_or(|(typename, _)| {
                    typename.is_empty()
                        || !typename.bytes().enumerate().all(|(index, byte)| {
                            byte == b'_'
                                || byte.is_ascii_alphabetic()
                                || (index > 0 && byte.is_ascii_digit())
                        })
                })
        }) {
            return Err(RecordSelectionError::InvalidKey.into());
        }
        if keys.is_empty() {
            return Ok(self.revisioned(Vec::new()));
        }
        self.hydrate_optimistic().await?;

        let selected_types: BTreeSet<_> =
            selection.type_names().iter().map(String::as_str).collect();
        let mut seen = BTreeSet::new();
        let ordered_keys: Vec<_> = keys
            .iter()
            .filter(|key| {
                record_key_type(key).is_some_and(|name| selected_types.contains(name))
                    && seen.insert((*key).clone())
            })
            .cloned()
            .collect();
        let key_set: BTreeSet<_> = ordered_keys.iter().cloned().collect();
        let mut bases = self.load_bases(&key_set).await?;
        let candidates = ordered_keys
            .iter()
            .cloned()
            .map(|key| {
                let record = bases.remove(&key);
                (key, record)
            })
            .collect();
        let optimistic = merged_optimistic(&self.optimistic);
        let projected = self
            .project_record_batch(selection, candidates, &optimistic)
            .await?;
        let mut projected: HashMap<_, _> = projected.into_iter().collect();
        let records = ordered_keys
            .into_iter()
            .filter_map(|record_key| {
                projected
                    .remove(&record_key)
                    .map(|record| SelectedRecord { record_key, record })
            })
            .collect();
        Ok(self.revisioned(records))
    }

    async fn project_record_batch(
        &mut self,
        selection: &RecordSelection,
        candidates: BTreeMap<EntityKey<'static>, Option<Record>>,
        optimistic: &BTreeMap<EntityKey<'static>, Record>,
    ) -> Result<Vec<(EntityKey<'static>, Json)>, EngineError<S::Error>> {
        let candidate_keys: Vec<_> = candidates.keys().cloned().collect();
        let optimistic_only_candidates: BTreeSet<_> = candidates
            .iter()
            .filter_map(|(key, record)| record.is_none().then_some(key.clone()))
            .collect();
        let mut fetched_base: HashMap<_, _> = candidates
            .into_iter()
            .filter_map(|(key, record)| record.map(|record| (key, record)))
            .collect();
        let mut composed = HashMap::new();
        for (key, update) in optimistic {
            let base = fetched_base.get(key).or_else(|| self.hot.peek(key));
            if let Some(base) = base {
                let mut effective = base.clone();
                effective.merge(update.clone());
                composed.insert(key.clone(), effective);
            } else if optimistic_only_candidates.contains(key) {
                composed.insert(key.clone(), update.clone());
            }
        }

        let variables = serde_json::Map::new();
        let mut pending: BTreeSet<_> = candidate_keys.iter().cloned().collect();
        let mut completed = BTreeMap::new();
        let mut known_absent = BTreeSet::new();
        while !pending.is_empty() {
            let mut missing = BTreeSet::new();
            let source = EngineSource {
                hot: &self.hot,
                fetched: &fetched_base,
                composed: &composed,
            };
            let current: Vec<_> = pending.iter().cloned().collect();
            for key in current {
                let type_name = record_key_type(&key).unwrap_or_default();
                let mut dependencies = BTreeSet::new();
                match denormalize_record(
                    &key,
                    type_name,
                    selection.selection_set(),
                    &variables,
                    &source,
                    &mut dependencies,
                )? {
                    ReadOutcome::Complete(record) => {
                        pending.remove(&key);
                        completed.insert(key, record);
                    }
                    ReadOutcome::Miss { .. } => {
                        pending.remove(&key);
                    }
                    ReadOutcome::NeedRecords(keys) => missing.extend(keys),
                }
            }
            if pending.is_empty() {
                break;
            }

            let to_fetch: Vec<_> = missing
                .into_iter()
                .filter(|key| {
                    !known_absent.contains(key)
                        && !fetched_base.contains_key(key)
                        && !composed.contains_key(key)
                })
                .collect();
            if to_fetch.is_empty() {
                break;
            }
            let fetched = self
                .storage
                .get_batch(&to_fetch)
                .await
                .map_err(EngineError::Storage)?;
            for (key, record) in to_fetch.into_iter().zip(fetched) {
                match record {
                    Some(record) => {
                        if let Some(update) = optimistic.get(&key) {
                            let mut effective = record.clone();
                            effective.merge(update.clone());
                            composed.insert(key.clone(), effective);
                        }
                        fetched_base.insert(key, record);
                    }
                    None => {
                        if let Some(update) = optimistic.get(&key) {
                            composed.insert(key, update.clone());
                        } else {
                            known_absent.insert(key);
                        }
                    }
                }
            }
        }

        for (key, record) in fetched_base {
            self.hot.put(key, record);
        }
        Ok(candidate_keys
            .into_iter()
            .filter_map(|key| completed.remove(&key).map(|record| (key, record)))
            .collect())
    }

    /// Searches the compact materialized projection without scanning or
    /// decoding normalized-record payloads.
    ///
    /// Empty queries fan out over the per-profile/per-bucket timestamp index.
    /// Text queries lazily load one compact catalog and rank it in memory.
    /// Active optimistic layers are projected from their fully composed record
    /// values and overlaid explicitly on either durable path.
    pub async fn search(
        &mut self,
        request: &SearchRequest,
    ) -> Result<SearchPage, EngineError<S::Error>> {
        let requested_buckets = validate_search_request(request)?;
        self.hydrate_optimistic().await?;
        let buckets: Vec<String> = if requested_buckets.is_empty() {
            request
                .profile
                .buckets()
                .iter()
                .map(|bucket| (*bucket).to_owned())
                .collect()
        } else {
            requested_buckets
        };
        let bucket_set: BTreeSet<_> = buckets.iter().map(String::as_str).collect();
        let overlay = self.optimistic_search_overlay(request.profile).await?;
        let trimmed_query = request.query.trim();

        let mut candidates: HashMap<EntityKey<'static>, SearchDocument> =
            if trimmed_query.is_empty() {
                // Fetch enough extra durable rows to compensate for optimistic
                // replacements/removals without turning this into a record scan.
                let per_bucket_limit = request
                    .limit
                    .saturating_add(overlay.len())
                    .saturating_add(1);
                let mut candidates = HashMap::new();
                for bucket in &buckets {
                    let rows = self
                        .storage
                        .browse_search_documents(
                            request.profile,
                            bucket,
                            request.cursor.as_ref(),
                            per_bucket_limit,
                        )
                        .await
                        .map_err(EngineError::Storage)?;
                    for document in rows {
                        candidates.insert(document.record_key.clone(), document);
                    }
                }
                candidates
            } else {
                if !self.search_catalogs.contains_key(&request.profile) {
                    let documents = self
                        .storage
                        .load_search_documents(request.profile)
                        .await
                        .map_err(EngineError::Storage)?;
                    self.search_catalogs.insert(
                        request.profile,
                        documents
                            .into_iter()
                            .map(|document| (document.record_key.clone(), document))
                            .collect(),
                    );
                }
                self.search_catalogs[&request.profile].clone()
            };

        for (key, document) in overlay {
            candidates.remove(&key);
            if let Some(document) = document
                && bucket_set.contains(document.bucket.as_str())
                && cursor_allows(request.cursor.as_ref(), &document)
            {
                candidates.insert(key, document);
            }
        }

        let mut scored: Vec<(SearchDocument, f64)> = candidates
            .into_values()
            .filter(|document| bucket_set.contains(document.bucket.as_str()))
            .filter(|document| cursor_allows(request.cursor.as_ref(), document))
            .filter_map(|document| {
                let score = if trimmed_query.is_empty() {
                    Some(0.0)
                } else {
                    fuzzy_freshness_score(&document, trimmed_query, request.now_ms)
                }?;
                Some((document, score))
            })
            .collect();
        if trimmed_query.is_empty() {
            scored.sort_by(|(left, _), (right, _)| compare_recent(left, right));
        } else {
            scored.sort_by(|(left, left_score), (right, right_score)| {
                right_score
                    .total_cmp(left_score)
                    .then_with(|| compare_recent(left, right))
            });
        }
        let has_more = scored.len() > request.limit;
        scored.truncate(request.limit);
        let documents: Vec<_> = scored.into_iter().map(|(document, _)| document).collect();
        let next_cursor = (trimmed_query.is_empty() && has_more).then(|| {
            let last = documents
                .last()
                .expect("a truncated search page contains a document");
            SearchCursor {
                timestamp_ms: last.timestamp_ms,
                record_key: last.record_key.clone(),
            }
        });
        Ok(SearchPage {
            documents,
            next_cursor,
        })
    }

    async fn optimistic_search_overlay(
        &mut self,
        profile: SearchProfile,
    ) -> Result<HashMap<EntityKey<'static>, Option<SearchDocument>>, EngineError<S::Error>> {
        let keys = layer_keys(&self.optimistic);
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        let bases = self.load_bases(&keys).await?;
        Ok(effective_records(&bases, &self.optimistic, &keys)
            .into_iter()
            .map(|(key, record)| {
                let document = record.and_then(|record| {
                    project_search_documents(&key, &record)
                        .into_iter()
                        .find(|document| document.profile == profile)
                });
                (key, document)
            })
            .collect())
    }

    fn update_loaded_search_catalogs(&mut self, entries: &[(EntityKey<'static>, Record)]) {
        if self.search_catalogs.is_empty() {
            return;
        }
        for (key, record) in entries {
            for catalog in self.search_catalogs.values_mut() {
                catalog.remove(key);
            }
            for document in project_search_documents(key, record) {
                if let Some(catalog) = self.search_catalogs.get_mut(&document.profile) {
                    catalog.insert(key.clone(), document);
                }
            }
        }
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
        self.write_query_with_registration(
            origin_op,
            None,
            NetworkWrite {
                query,
                operation_name,
                variables,
                data,
                identity,
            },
        )
        .await
    }

    /// Normalizes and stores a network response, installing the active query's
    /// dependencies from the same response without denormalizing it again.
    pub async fn write_query_with_registration(
        &mut self,
        origin_op: Option<OpId>,
        registration: Option<QueryRegistration<'_>>,
        input: NetworkWrite<'_>,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.write_query_with_registration_and_projections(
            origin_op,
            registration,
            input,
            Vec::new(),
        )
        .await
    }

    /// Normalizes records and atomically applies caller-composed generic projections.
    pub async fn write_query_with_registration_and_projections(
        &mut self,
        origin_op: Option<OpId>,
        registration: Option<QueryRegistration<'_>>,
        input: NetworkWrite<'_>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let NetworkWrite {
            query,
            operation_name,
            variables,
            data,
            identity,
        } = input;
        self.hydrate_optimistic().await?;
        let entity_resolvers = EntityResolverLookup::compile(
            registration.map_or(&[][..], |registration| registration.entity_resolvers),
        )?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        if registration.is_some() && op.kind != OperationKind::Query {
            return Err(EngineError::Document(
                DocumentError::UnsupportedOperationType(format!(
                    "{:?} (dependency registration is query-only)",
                    op.kind
                )),
            ));
        }
        let normalized = normalize_with_dependencies(op, variables, data, &entity_resolvers)?;
        let updates = normalized.updates;

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
                    self.search_catalogs.clear();
                    self.storage.clear().await.map_err(EngineError::Storage)?;
                    self.bind_identity(observed).await?;
                    reset = true;
                }
            }
        }

        let mut candidates = layer_keys(&self.optimistic);
        candidates.extend(updates.keys().cloned());
        let bases_before = self.load_bases(&candidates).await?;
        let before = effective_records(&bases_before, &self.optimistic, &candidates);
        let (changed, revision) = self.persist_updates(updates, projections).await?;

        if !self.optimistic.is_empty() {
            let queued = self
                .storage
                .load_mutation_queue()
                .await
                .map_err(EngineError::Storage)?;
            self.optimistic = self.rebuild_queued_layers(queued).await?;
            candidates.extend(layer_keys(&self.optimistic));
        }
        let bases_after = self.load_bases(&candidates).await?;
        let after = effective_records(&bases_after, &self.optimistic, &candidates);
        let visible_changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();

        let mut affected_ops = if reset {
            // Everything anyone had cached is gone: re-execute all ops.
            self.deps.all_ops()
        } else {
            self.deps.ops_for_keys(visible_changed.iter())
        };
        if let Some(origin) = origin_op {
            affected_ops.remove(&origin);
        }
        if let Some(registration) = registration {
            if normalized.completeness == DependencyCompleteness::Exact
                && self.optimistic.is_empty()
            {
                self.deps
                    .set_op_deps(registration.op_id, normalized.dependencies);
            } else {
                self.deps.set_op_broad(registration.op_id);
            }
        }
        Ok(WriteResult {
            revision,
            changed,
            affected_ops,
            reset,
            revalidations: Vec::new(),
        })
    }

    /// Stores a network response and returns only fields not marked
    /// `@cacheOnly`. Projection is taken directly from the validated network
    /// payload, so hydration never denormalizes the response back out of
    /// storage.
    pub async fn hydrate_query(
        &mut self,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
        identity: Option<&str>,
    ) -> Result<HydrationWriteResult, EngineError<S::Error>> {
        self.hydrate_query_with_projections(
            query,
            operation_name,
            variables,
            data,
            identity,
            Vec::new(),
        )
        .await
    }

    /// Hydrates a response while atomically maintaining generic projections.
    pub async fn hydrate_query_with_projections(
        &mut self,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
        identity: Option<&str>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<HydrationWriteResult, EngineError<S::Error>> {
        let projected = {
            let doc = Self::document(&mut self.docs, query)?;
            let op = doc.operation(operation_name)?;
            if op.kind != OperationKind::Query {
                return Err(EngineError::Document(
                    DocumentError::UnsupportedOperationType(format!(
                        "{:?} (cache hydration is query-only)",
                        op.kind
                    )),
                ));
            }
            project_hydration_response(op, data)?
        };
        let write_result = self
            .write_query_with_registration_and_projections(
                None,
                None,
                NetworkWrite {
                    query,
                    operation_name,
                    variables,
                    data,
                    identity,
                },
                projections,
            )
            .await?;
        Ok(HydrationWriteResult {
            write_result,
            data: projected,
        })
    }

    /// Merges normalized updates into the hot tier and storage. Returns the
    /// keys whose durable contents actually changed.
    async fn persist_updates(
        &mut self,
        updates: RecordUpdates,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(BTreeSet<EntityKey<'static>>, CacheRevision), EngineError<S::Error>> {
        // Load current values (hot tier, then storage) so merges detect real
        // changes. Merges are staged in a plain map, NOT the LRU: a batch
        // larger than the hot capacity would otherwise evict its own
        // records mid-merge and overwrite storage with partial updates.
        let mut staging: HashMap<EntityKey<'static>, Record> = HashMap::new();
        let mut missing: Vec<EntityKey<'static>> = Vec::new();
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
        let mut to_persist: Vec<(EntityKey<'static>, Record)> = Vec::new();
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
            .put_batch_with_projections(to_persist.clone(), projections)
            .await
            .map_err(EngineError::Storage)?;
        let revision = self.advance_revision()?;
        self.update_loaded_search_catalogs(&to_persist);
        Ok((changed, revision))
    }

    /// Atomically enqueues a mutation together with its optimistic layer.
    /// The layer is durable before it becomes visible or the caller is
    /// allowed to forward the mutation to the network.
    pub async fn begin_optimistic_write(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
    ) -> Result<(OptimisticTransactionId, WriteResult), EngineError<S::Error>> {
        self.begin_optimistic_write_with_projections(origin_op, input, Vec::new())
            .await
    }

    /// Atomically enqueue an optimistic normalized layer and generic projection overlay.
    pub async fn begin_optimistic_write_with_projections(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
        projection_mutations: Vec<OptimisticProjectionMutation>,
    ) -> Result<(OptimisticTransactionId, WriteResult), EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let BeginOptimisticWrite {
            query,
            operation_name,
            variables,
            data,
            link_patches,
            revalidations,
            created_at_ms,
        } = input;
        self.hydrate_optimistic().await?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let mut updates = normalize(op, variables, data)?;
        let patches = deduplicate_patches(link_patches)?;
        let revalidations = deduplicate_revalidations(
            revalidations
                .iter()
                .cloned()
                .chain(patches.iter().map(OptimisticLinkPatch::revalidation)),
        );

        let candidates: BTreeSet<EntityKey<'static>> = updates.keys().cloned().collect();
        let optimistic = self.optimistic.clone();
        let (candidates, bases) = self
            .load_link_patch_bases(candidates, &optimistic, &updates, &patches)
            .await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        let mut effective = present_records(before.clone());
        merge_updates_into_effective(&mut effective, &updates);
        // This stages on clones internally, so no part of an invalid patch
        // set can become visible or durable.
        apply_link_patches(&mut effective, &mut updates, &patches, false)?;

        let identity = match self.bound_identity().await? {
            IdentityState::Bound(identity) => Some(identity),
            IdentityState::NotHydrated | IdentityState::Missing => None,
        };
        for mutation in &projection_mutations {
            mutation
                .validate()
                .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?;
        }
        let shadow_replacements = if projection_mutations.is_empty() {
            Vec::new()
        } else {
            let keys = projection_mutations
                .iter()
                .map(|mutation| mutation.record_key().clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let authoritative = self
                .storage
                .load_projection_states(&keys)
                .await
                .map_err(EngineError::Storage)?;
            let current = self
                .storage
                .load_optimistic_projections(&keys)
                .await
                .map_err(EngineError::Storage)?;
            if authoritative.len() != keys.len() || current.len() != keys.len() {
                return Err(EngineError::InvalidOptimisticProjection(
                    "storage returned misaligned optimistic projection bases".to_owned(),
                ));
            }
            keys.iter()
                .zip(authoritative.iter())
                .zip(current.iter())
                .map(|((key, authoritative), current)| {
                    compose_pending_optimistic_projection(
                        key,
                        authoritative.as_ref(),
                        current.as_ref(),
                        &projection_mutations,
                    )
                    .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?
                    .ok_or_else(|| {
                        EngineError::InvalidOptimisticProjection(
                            "touched optimistic projection key was not composed".to_owned(),
                        )
                    })
                })
                .collect::<Result<Vec<_>, _>>()?
        };
        let source = OptimisticSource {
            mutation_data: data.clone(),
            link_patches: patches.clone(),
            revalidations: revalidations.clone(),
            projection_mutations: projection_mutations.clone(),
        };
        let id = self
            .storage
            .enqueue_mutation_with_shadow(
                NewQueuedMutation {
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
                        optimistic_data_json: encode_optimistic_source(&source),
                        normalized_updates: updates.clone(),
                    },
                },
                shadow_replacements,
            )
            .await
            .map_err(EngineError::Storage)?;
        self.optimistic.push(OptimisticLayer {
            id,
            updates,
            link_patches: patches,
            revalidations,
            projection_mutations,
        });

        let after = effective_records(&bases, &self.optimistic, &candidates);
        let changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let mut affected_ops = self.deps.ops_for_keys(changed.iter());
        if let Some(origin) = origin_op {
            affected_ops.remove(&origin);
        }
        let revision = self.advance_revision()?;
        Ok((
            id,
            WriteResult {
                revision,
                changed,
                affected_ops,
                reset: false,
                revalidations: Vec::new(),
            },
        ))
    }

    /// Durably enqueues a mutation and publishes its optimistic layer, then
    /// attempts to claim the strict queue head before returning. A claim
    /// failure is nested in the successful enqueue result so callers never
    /// bypass or duplicate an already durable mutation.
    pub async fn enqueue_optimistic_mutation(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
        claim: MutationClaimRequest,
    ) -> Result<EnqueueOptimisticMutationResult<EngineError<S::Error>>, EngineError<S::Error>> {
        self.enqueue_optimistic_mutation_with_projections(origin_op, input, claim, Vec::new())
            .await
    }

    /// Durably enqueue normalized optimism and a queryable projection overlay.
    pub async fn enqueue_optimistic_mutation_with_projections(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
        claim: MutationClaimRequest,
        projection_mutations: Vec<OptimisticProjectionMutation>,
    ) -> Result<EnqueueOptimisticMutationResult<EngineError<S::Error>>, EngineError<S::Error>> {
        let (transaction_id, write_result) = self
            .begin_optimistic_write_with_projections(origin_op, input, projection_mutations)
            .await?;
        let initial_claim = match self.claim_next_mutation(claim).await {
            Ok(Some(claimed)) => InitialClaimOutcome::Claimed(Box::new(claimed)),
            Ok(None) => InitialClaimOutcome::NotRunnable,
            Err(error) => InitialClaimOutcome::Failed(error),
        };
        Ok(EnqueueOptimisticMutationResult {
            transaction_id,
            write_result,
            initial_claim,
        })
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

    async fn stage_shadow_reconciliation(
        &self,
        transaction: OptimisticTransactionId,
        authoritative_mutations: &[ProjectionMutation],
    ) -> Result<OptimisticShadowReconciliation, EngineError<S::Error>> {
        let expected_queue = self
            .optimistic
            .iter()
            .map(|layer| layer.id)
            .collect::<Vec<_>>();
        let settled = self
            .optimistic
            .iter()
            .find(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let affected_keys = settled
            .projection_mutations
            .iter()
            .map(|mutation| mutation.record_key().clone())
            .chain(
                authoritative_mutations
                    .iter()
                    .map(|mutation| mutation.record_key().clone()),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let loaded = self
            .storage
            .load_projection_states(&affected_keys)
            .await
            .map_err(EngineError::Storage)?;
        if loaded.len() != affected_keys.len() {
            return Err(EngineError::InvalidOptimisticProjection(
                "storage returned misaligned authoritative projection states".to_owned(),
            ));
        }
        let mut authoritative = affected_keys
            .iter()
            .cloned()
            .zip(loaded)
            .collect::<BTreeMap<_, _>>();
        for mutation in authoritative_mutations {
            match mutation {
                ProjectionMutation::Replace(document) => {
                    let mut document = document.clone();
                    document.canonicalize();
                    document.validate().map_err(|error| {
                        EngineError::InvalidOptimisticProjection(error.to_string())
                    })?;
                    authoritative.insert(
                        document.record_key.clone(),
                        Some(ProjectionState::Complete(document)),
                    );
                }
                ProjectionMutation::MarkIncomplete {
                    record_key,
                    profile,
                    partition,
                    kind,
                } => {
                    authoritative.insert(
                        record_key.clone(),
                        Some(ProjectionState::Incomplete {
                            record_key: record_key.clone(),
                            profile: profile.clone(),
                            partition: partition.clone(),
                            kind: *kind,
                        }),
                    );
                }
                ProjectionMutation::Delete(record_key) => {
                    authoritative.insert(record_key.clone(), None);
                }
            }
        }
        let remaining_layers = self
            .optimistic
            .iter()
            .filter(|layer| layer.id != transaction)
            .map(|layer| ProjectionMutationLayer {
                owner: layer.id,
                mutations: &layer.projection_mutations,
            })
            .collect::<Vec<_>>();
        let replacements = affected_keys
            .iter()
            .filter_map(|key| {
                compose_effective_optimistic_projection(
                    key,
                    authoritative.get(key).and_then(Option::as_ref),
                    &remaining_layers,
                )
                .transpose()
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?;
        let reconciliation = OptimisticShadowReconciliation {
            expected_queue,
            affected_keys,
            replacements,
        };
        if reconciliation.expected_queue.first().copied() != Some(transaction) {
            return Err(EngineError::StaleMutationClaim(transaction));
        }
        reconciliation
            .validate(transaction)
            .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?;
        Ok(reconciliation)
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
        self.commit_optimistic_write_with_projections(
            transaction,
            claim,
            query,
            operation_name,
            variables,
            data,
            Vec::new(),
        )
        .await
    }

    /// Settles an optimistic write with atomic generic projection replacement.
    #[allow(clippy::too_many_arguments)]
    pub async fn commit_optimistic_write_with_projections(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
        projections: Vec<ProjectionMutation>,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.hydrate_optimistic().await?;
        let index = self
            .optimistic
            .iter()
            .position(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let recipes = self.optimistic[index].link_patches.clone();
        let revalidations = self.optimistic[index].revalidations.clone();
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let mut updates = normalize(op, variables, data)?;

        let mut candidates = layer_keys(&self.optimistic);
        candidates.extend(updates.keys().cloned());
        let (mut candidates, bases) = self
            .load_link_patch_bases(candidates, &[], &updates, &recipes)
            .await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);

        // Reapply the idempotent recipes to the latest durable base, never a
        // captured optimistic query snapshot. Stale/missing fields are skipped
        // and recovered by the returned revalidations.
        let mut effective = bases.clone();
        merge_updates_into_effective(&mut effective, &updates);
        apply_link_patches(&mut effective, &mut updates, &recipes, true)?;
        let (durable_changed, entries) = stage_updates(&bases, updates);
        let reconciliation = self
            .stage_shadow_reconciliation(transaction, &projections)
            .await?;
        if !self
            .storage
            .complete_mutation_with_shadow(
                transaction,
                claim,
                entries.clone(),
                projections,
                reconciliation,
            )
            .await
            .map_err(EngineError::Storage)?
        {
            return Err(EngineError::StaleMutationClaim(transaction));
        }
        let revision = self.advance_revision()?;
        self.update_loaded_search_catalogs(&entries);
        for (key, record) in entries {
            self.hot.put(key, record);
        }

        // Reconstruct every later recipe against the settled base. This is
        // required when an earlier layer is committed or rolled back: later
        // layers must not retain a whole-field snapshot of the old base.
        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        let replacement = self.rebuild_queued_layers(queued).await?;
        candidates.extend(layer_keys(&replacement));
        let settled_bases = self.load_bases(&candidates).await?;
        let after = effective_records(&settled_bases, &replacement, &candidates);
        self.optimistic = replacement;
        let visible_changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(visible_changed.iter());
        Ok(WriteResult {
            revision,
            changed: durable_changed,
            affected_ops,
            reset: false,
            revalidations,
        })
    }

    /// Permanently fails the claimed head, atomically removing its queue row
    /// and optimistic layer.
    pub async fn rollback_optimistic_write(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.hydrate_optimistic().await?;
        self.optimistic
            .iter()
            .position(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let mut candidates = layer_keys(&self.optimistic);
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        let reconciliation = self.stage_shadow_reconciliation(transaction, &[]).await?;
        if !self
            .storage
            .discard_mutation_with_shadow(transaction, claim, reconciliation)
            .await
            .map_err(EngineError::Storage)?
        {
            return Err(EngineError::StaleMutationClaim(transaction));
        }
        let revision = self.advance_revision()?;
        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        let replacement = self.rebuild_queued_layers(queued).await?;
        candidates.extend(layer_keys(&replacement));
        let current_bases = self.load_bases(&candidates).await?;
        let after = effective_records(&current_bases, &replacement, &candidates);
        self.optimistic = replacement;
        let visible_changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(visible_changed.iter());
        Ok(WriteResult {
            revision,
            changed: BTreeSet::new(),
            affected_ops,
            reset: false,
            revalidations: Vec::new(),
        })
    }

    /// Loads every normalized record reached while resolving query-rooted
    /// link updates, including records currently outside the hot tier.
    async fn load_link_patch_bases(
        &mut self,
        mut candidates: BTreeSet<EntityKey<'static>>,
        layers: &[OptimisticLayer],
        pending_updates: &RecordUpdates,
        patches: &[OptimisticLinkPatch],
    ) -> Result<
        (
            BTreeSet<EntityKey<'static>>,
            HashMap<EntityKey<'static>, Record>,
        ),
        EngineError<S::Error>,
    > {
        if !patches.is_empty() {
            candidates.insert(EntityKey::root());
        }
        loop {
            let bases = self.load_bases(&candidates).await?;
            let composed = effective_records(&bases, layers, &candidates);
            let mut effective = present_records(composed);
            merge_updates_into_effective(&mut effective, pending_updates);
            let missing: BTreeSet<_> = patches
                .iter()
                .filter_map(|patch| missing_patch_record(&effective, patch))
                .filter(|key| !candidates.contains(key))
                .collect();
            if missing.is_empty() {
                return Ok((candidates, bases));
            }
            candidates.extend(missing);
        }
    }

    /// Loads current durable records (hot tier, then storage) for `keys`
    /// without touching LRU recency or persisting anything.
    async fn load_bases(
        &mut self,
        keys: &BTreeSet<EntityKey<'static>>,
    ) -> Result<HashMap<EntityKey<'static>, Record>, EngineError<S::Error>> {
        let mut out = HashMap::new();
        let mut missing = Vec::new();
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

    /// Recovers cached argument variants of one generated query field.
    ///
    /// Only records needed to resolve the selected field's normalized owner
    /// are loaded. The recovered variants are not denormalized.
    pub async fn inspect_query_variants(
        &mut self,
        inspection: &QueryInspection,
    ) -> Result<Vec<CachedQueryVariant>, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let operation = Self::document(&mut self.docs, &inspection.query)?
            .operation(inspection.operation_name.as_deref())?
            .clone();
        let prepared = prepare(&operation, &inspection.path)?;

        let mut candidates = BTreeSet::from([EntityKey::root()]);
        let variants = loop {
            let bases = self.load_bases(&candidates).await?;
            let effective =
                present_records(effective_records(&bases, &self.optimistic, &candidates));
            match resolve_owner(&effective, &operation, &inspection.path)? {
                OwnerResolution::Owner(owner) => break recover_variants(&owner, &prepared)?,
                OwnerResolution::Absent => return Ok(Vec::new()),
                OwnerResolution::NeedRecord(key) if !candidates.contains(&key) => {
                    candidates.insert(key.into_owned());
                }
                OwnerResolution::NeedRecord(_) => return Ok(Vec::new()),
            }
        };
        Ok(variants
            .into_iter()
            .map(|variables| CachedQueryVariant { variables })
            .collect())
    }

    /// Enumerates and materializes cached argument variants of one generated
    /// query field.
    ///
    /// Normalized owners, canonical field keys, cold records, and optimistic
    /// layers remain internal. Every recovered variable set is read through
    /// the ordinary denormalizer so inspection has cache-only read semantics.
    pub async fn inspect_query(
        &mut self,
        inspection: &QueryInspection,
    ) -> Result<Vec<CachedQueryInstance>, EngineError<S::Error>> {
        let variants = self.inspect_query_variants(inspection).await?;
        let mut instances = Vec::with_capacity(variants.len());
        for CachedQueryVariant { variables } in variants {
            if !matches_variable_filters(&variables, &inspection.variable_filters) {
                continue;
            }
            let value = match self
                .read_query(
                    None,
                    &inspection.query,
                    inspection.operation_name.as_deref(),
                    &variables,
                )
                .await?
            {
                ReadResult::Hit { data } => Some(selected_result_value(&data, &inspection.path)?),
                ReadResult::Miss => None,
            };
            instances.push(CachedQueryInstance { variables, value });
        }
        Ok(instances)
    }

    /// Reacts to a reset performed by *another* engine instance sharing the
    /// same storage (cross-tab broadcast): drops all local in-memory state
    /// and returns every local active operation for re-execution.
    pub fn external_reset(&mut self) -> Result<Revisioned<BTreeSet<OpId>>, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.hot.clear();
        self.docs.clear();
        self.optimistic.clear();
        self.search_catalogs.clear();
        // Another engine may have rebound the shared storage and changed the
        // durable queue, so both identity and optimism must re-hydrate.
        self.optimistic_hydrated = false;
        self.identity = IdentityState::NotHydrated;
        let affected = self.deps.all_ops();
        self.advance_revision()?;
        Ok(self.revisioned(affected))
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
        keys: impl IntoIterator<Item = &'k EntityKey<'static>>,
    ) -> Result<Revisioned<BTreeSet<OpId>>, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let affected = self.invalidate_keys_inner(keys);
        self.advance_revision()?;
        Ok(self.revisioned(affected))
    }

    fn invalidate_keys_inner<'k>(
        &mut self,
        keys: impl IntoIterator<Item = &'k EntityKey<'static>>,
    ) -> BTreeSet<OpId> {
        let mut affected = BTreeSet::new();
        for key in keys {
            self.hot.pop(key);
            affected.extend(self.deps.ops_for_keys([key]));
        }
        // The durable projection was updated by the writing context. Reload
        // only the compact catalog on the next text search.
        self.search_catalogs.clear();
        affected
    }

    /// Deletes locally stale records from both durable and hot tiers and
    /// returns active operations that traversed those records.
    ///
    /// Use this for an explicit server-provided cache-deletion effect.
    /// Cross-engine notifications for records already written to shared
    /// storage should use
    /// [`Self::invalidate_keys`] instead.
    pub async fn delete_keys(
        &mut self,
        keys: &[EntityKey<'static>],
    ) -> Result<Revisioned<BTreeSet<OpId>>, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let affected = self.deps.ops_for_keys(keys.iter());
        self.storage
            .delete_batch(keys)
            .await
            .map_err(EngineError::Storage)?;
        for key in keys {
            self.hot.pop(key);
            for catalog in self.search_catalogs.values_mut() {
                catalog.remove(key);
            }
        }
        self.advance_revision()?;
        Ok(self.revisioned(affected))
    }

    /// Drops all cached state (for example, on logout), including any pending
    /// optimistic layers.
    pub async fn clear(&mut self) -> Result<CacheRevision, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.hot.clear();
        self.optimistic.clear();
        self.optimistic_hydrated = true;
        self.search_catalogs.clear();
        self.deps = DepIndex::new();
        // The wipe below removes the binding record too.
        self.identity = IdentityState::Missing;
        self.storage.clear().await.map_err(EngineError::Storage)?;
        self.advance_revision()
    }

    pub fn active_ops(&self) -> usize {
        self.deps.active_ops()
    }

    /// Returns payload-free durable mutation queue diagnostics.
    pub async fn queue_diagnostics(&self) -> Result<QueueDiagnostics, EngineError<S::Error>> {
        self.storage
            .queue_diagnostics()
            .await
            .map_err(EngineError::Storage)
    }

    /// Access to the underlying storage for non-consuming diagnostics.
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// Consumes the engine and returns its owned storage.
    ///
    /// Hosts must use this transition for storage lifecycles that require
    /// exclusive ownership, such as proving that a browser database connection
    /// is closed before preserving or physically resetting its OPFS files.
    pub fn into_storage(self) -> S {
        self.storage
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

impl<S: PredicateIndexStorage> Engine<S> {
    /// Atomically persist normalized records and generic projection lifecycle changes.
    pub async fn put_records_with_projections(
        &mut self,
        origin_op: Option<OpId>,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let mut updates = RecordUpdates::new();
        for (key, record) in entries {
            updates.entry(key).or_default().merge(record);
        }
        let (changed, revision) = self.persist_updates(updates, projections).await?;
        let mut affected_ops = self.deps.ops_for_keys(changed.iter());
        if let Some(origin_op) = origin_op {
            affected_ops.remove(&origin_op);
        }
        Ok(WriteResult {
            revision,
            changed,
            affected_ops,
            reset: false,
            revalidations: Vec::new(),
        })
    }

    /// Mark projections incomplete atomically without changing normalized base records.
    pub async fn mark_projections_incomplete(
        &mut self,
        projections: Vec<ProjectionMutation>,
    ) -> Result<CacheRevision, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.storage
            .put_batch_with_projections(Vec::new(), projections)
            .await
            .map_err(EngineError::Storage)?;
        self.advance_revision()
    }

    /// Marks generic projections incomplete and invalidates normalized hot-tier records
    /// as one externally observed logical view mutation.
    pub async fn invalidate_keys_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projections: Vec<ProjectionMutation>,
    ) -> Result<Revisioned<BTreeSet<OpId>>, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.storage
            .put_batch_with_projections(Vec::new(), projections)
            .await
            .map_err(EngineError::Storage)?;
        let affected = self.invalidate_keys_inner(keys.iter());
        self.advance_revision()?;
        Ok(self.revisioned(affected))
    }

    /// Delete normalized records and generic projections in one storage transaction.
    pub async fn delete_keys_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projection_keys: &[PredicateRecordKey],
    ) -> Result<Revisioned<BTreeSet<OpId>>, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let affected = self.deps.ops_for_keys(keys.iter());
        self.storage
            .delete_batch_with_projections(keys, projection_keys)
            .await
            .map_err(EngineError::Storage)?;
        for key in keys {
            self.hot.pop(key);
            for catalog in self.search_catalogs.values_mut() {
                catalog.remove(key);
            }
        }
        self.advance_revision()?;
        Ok(self.revisioned(affected))
    }

    /// Execute a complete generic exact-index query over authoritative and optimistic projections.
    pub async fn query_predicate_index(
        &mut self,
        query: &ValidatedIndexQuery,
    ) -> Result<Revisioned<PredicateQueryResult>, EngineError<S::Error>> {
        let value = self.query_predicate_index_value(query).await?;
        Ok(self.revisioned(value))
    }

    async fn query_predicate_index_value(
        &mut self,
        query: &ValidatedIndexQuery,
    ) -> Result<PredicateQueryResult, EngineError<S::Error>> {
        self.storage
            .query_predicate_index(query)
            .await
            .map_err(EngineError::Storage)
    }
}

/// Read view over the durable tiers plus the optimistic composition. Uses
/// `peek` (no recency mutation) — recency is refreshed once per read from
/// the dep set.
struct EngineSource<'a> {
    hot: &'a LruCache<EntityKey<'static>, Record>,
    /// Durable records batch-fetched from storage during this read.
    fetched: &'a HashMap<EntityKey<'static>, Record>,
    /// Optimistically touched keys: durable base + layers, pre-merged.
    /// Takes precedence over both durable tiers.
    composed: &'a HashMap<EntityKey<'static>, Record>,
}

impl RecordSource for EngineSource<'_> {
    fn get(&self, key: &EntityKey<'static>) -> Option<&Record> {
        self.composed
            .get(key)
            .or_else(|| self.fetched.get(key))
            .or_else(|| self.hot.peek(key))
    }
}

/// All active optimistic layers' updates merged in creation order (later
/// layers override earlier ones field-by-field).
fn merged_optimistic(layers: &[OptimisticLayer]) -> BTreeMap<EntityKey<'static>, Record> {
    let mut out: BTreeMap<EntityKey<'static>, Record> = BTreeMap::new();
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
    bases: &HashMap<EntityKey<'static>, Record>,
    updates: RecordUpdates,
) -> (
    BTreeSet<EntityKey<'static>>,
    Vec<(EntityKey<'static>, Record)>,
) {
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
    bases: &HashMap<EntityKey<'static>, Record>,
    layers: &[OptimisticLayer],
    keys: &BTreeSet<EntityKey<'static>>,
) -> HashMap<EntityKey<'static>, Option<Record>> {
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

fn present_records(
    records: HashMap<EntityKey<'static>, Option<Record>>,
) -> HashMap<EntityKey<'static>, Record> {
    records
        .into_iter()
        .filter_map(|(key, record)| record.map(|record| (key, record)))
        .collect()
}

fn merge_updates_into_effective(
    effective: &mut HashMap<EntityKey<'static>, Record>,
    updates: &RecordUpdates,
) {
    for (key, update) in updates {
        effective
            .entry(key.clone())
            .or_default()
            .merge(update.clone());
    }
}

fn layer_keys(layers: &[OptimisticLayer]) -> BTreeSet<EntityKey<'static>> {
    layers
        .iter()
        .flat_map(|layer| layer.updates.keys().cloned())
        .collect()
}

fn record_key_type<'a>(key: &'a EntityKey<'a>) -> Option<&'a str> {
    key.0.split_once(':').map(|(type_name, _)| type_name)
}

fn cursor_allows(cursor: Option<&SearchCursor>, document: &SearchDocument) -> bool {
    cursor.is_none_or(|cursor| {
        document.timestamp_ms < cursor.timestamp_ms
            || (document.timestamp_ms == cursor.timestamp_ms
                && document.record_key > cursor.record_key)
    })
}

fn deduplicate_revalidations(
    revalidations: impl IntoIterator<Item = QueryRevalidation>,
) -> Vec<QueryRevalidation> {
    let mut unique = BTreeSet::new();
    for mut revalidation in revalidations {
        if let Ok(variables) = serde_json::from_str::<Json>(&revalidation.variables_json) {
            revalidation.variables_json = canonical_json(&variables);
        }
        unique.insert(revalidation);
    }
    unique.into_iter().collect()
}
