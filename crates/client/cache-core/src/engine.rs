//! The cache engine: ties documents, normalization, the hot tier, storage
//! and dependency tracking together behind the API the hosts (wasm worker /
//! Tauri) expose over RPC.

#[cfg(test)]
mod test;

pub mod live_query;
pub mod watch_query;

use crate::denormalize::{DenormalizeError, ReadOutcome, ReadPlans, ReadSession, RecordSource};
use crate::deps::{
    DepIndex, OpId, QueryDependencies, ViewerFieldUpdate, ViewerFields, changed_viewer_fields,
};
use crate::document::{Document, DocumentError, OperationKind};
use crate::entity_resolver::{EntityResolver, EntityResolverError, EntityResolverLookup};
use crate::identity::{self, IdentityBinding, IdentityMap};
use crate::link_patch::{
    LinkPatchError, OptimisticLinkPatch, QueryRevalidation, apply_link_patches,
    deduplicate_patches, missing_patch_records,
};
use crate::normalize::{
    DependencyCompleteness, NormalizeError, RecordUpdates, normalize, normalize_with_dependencies,
    project_hydration_response,
};
use crate::predicate::reconciliation::{
    MAX_RECONCILIATION_BASELINE, PredicateBaselineEntry, PredicateReconciliation,
};
use crate::predicate::{
    OptimisticShadowReconciliation, OptimisticUpsertReconciliation, PredicateIndexStorage,
    PredicateQueryResult, ProjectionMutation, ProjectionMutationLayer, ProjectionState,
    StagedOptimisticProjection, StagedOptimisticProjectionOwner, apply_authoritative_exact_members,
    apply_authoritative_projection_mutations, apply_authoritative_projection_patch,
    compose_effective_optimistic_projection,
};
use crate::query_inspection::{
    CachedQueryInstance, CachedQueryVariant, OwnerResolution, QueryInspection,
    QueryInspectionError, matches_variable_filters, prepare, recover_variants, resolve_owner,
    selected_result_value,
};
use crate::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, MutationQueueSnapshot,
    MutationRequest, MutationUpsertKind, NewQueuedMutation, OptimisticSource,
    PersistedOptimisticLayer, QueuedMutation, StoredMutation, decode_optimistic_source,
    encode_optimistic_source,
};
use crate::record_selection::{
    MAX_RECORD_SELECTION_KEYS, RecordSelection, RecordSelectionError, SelectedRecord,
};
use crate::revision::{CacheRevision, Revisioned};
use crate::search::{
    SearchCatalogs, SearchCursor, SearchDocument, SearchError, SearchPage, SearchProfile,
    SearchRequest, collect_search_changes, project_search_documents, rank_documents,
    snapshot_search_fields, validate_search_request,
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
use uuid::Uuid;

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
    /// Identity resolution and normalization failed; the mutation was durably discarded.
    #[error("invalid optimistic identity: {}", .0.error)]
    IdentityResolutionFailed(Box<FailedMutationResult>),
    #[error("invalid optimistic mutation UUID `{0}`")]
    InvalidMutationUuid(String),
    #[error("durable optimistic queue changed while staging UUID upsert")]
    StaleOptimisticUpsert,
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
    /// Effective scalar changes; absent when consumers must re-read queries.
    pub field_changes: Option<Vec<crate::field_changes::RecordFieldChange>>,
    /// Identity bindings omitted while committing otherwise normalizable server data.
    pub identity_errors: Vec<String>,
    /// Revision installed after this logical cache mutation.
    pub revision: CacheRevision,
    /// Whether this write advanced [`Self::revision`].
    pub revision_advanced: bool,
    /// Search buckets changed by an ordinary query response. `None` keeps
    /// mutation/reset notifications conservative; an empty set proves no change.
    pub search_changed_buckets: Option<BTreeSet<String>>,
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
    /// Queries that should be revalidated after terminal settlement.
    pub revalidations: Vec<QueryRevalidation>,
    /// Stable caller identity of a settled mutation.
    pub mutation_uuid: Option<String>,
}

/// Internal durable deltas; viewer field proof is never sent across host boundaries.
struct PersistedChanges {
    field_changes: Vec<crate::field_changes::RecordFieldChange>,
    changed: BTreeSet<EntityKey<'static>>,
    revision: CacheRevision,
    revision_advanced: bool,
    search_changed_buckets: BTreeSet<String>,
    viewer_fields: ViewerFields,
}

/// Result of hydrating a query while returning only non-`@cacheOnly` fields.
#[derive(Debug)]
pub struct HydrationWriteResult {
    /// Quick Access buckets whose searchable or materialized fields changed.
    /// An empty set proves that search-backed consumers need no refresh.
    pub search_changed_buckets: BTreeSet<String>,
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
    /// How the caller UUID changed the queue.
    pub upsert_kind: MutationUpsertKind,
    /// Visible cache changes caused by the newly published optimistic layer.
    pub write_result: WriteResult,
    /// Outcome of the claim attempt made before hosts publish cache changes.
    pub initial_claim: InitialClaimOutcome<E>,
}

/// Cache change and replacement identity produced by settling superseded work.
#[derive(Debug)]
pub struct SupersededMutationResult {
    /// Cache changes caused by settling the superseded layer.
    pub write_result: WriteResult,
    /// Current transaction carrying the caller's newer intent.
    pub replacement_transaction_id: OptimisticTransactionId,
}

/// Tagged commit result used by transport adapters for settlement fanout.
#[derive(Debug)]
pub enum CommitOptimisticWriteResult {
    /// A current mutation committed normally.
    Committed(WriteResult),
    /// The response committed beneath a newer optimistic replacement.
    CommittedSuperseded(SupersededMutationResult),
    /// Invalid identity data and an unnormalizable response permanently failed this attempt.
    Failed(FailedMutationResult),
}

/// Cache changes and diagnostics from a permanently failed commit attempt.
#[derive(Debug)]
pub struct FailedMutationResult {
    /// Changes caused by removing the failed optimistic layer.
    pub write_result: WriteResult,
    /// Identity-resolution diagnostic for the host's cache error handler.
    pub error: String,
    /// Newer intent preserved when the failed attempt was superseded.
    pub replacement_transaction_id: Option<OptimisticTransactionId>,
}

/// Result of attempting to defer a failed queue attempt.
#[derive(Debug)]
pub enum DeferOptimisticWriteResult {
    /// The current mutation retained its optimistic layer and retry state.
    Deferred,
    /// The attempt was superseded, so it was discarded instead of retried.
    DiscardedSuperseded(SupersededMutationResult),
}

/// Tagged rollback result used by transport adapters for settlement fanout.
#[derive(Debug)]
pub enum RollbackOptimisticWriteResult {
    /// A current mutation permanently failed normally.
    RolledBack(WriteResult),
    /// A superseded attempt was accepted and discarded.
    DiscardedSuperseded(SupersededMutationResult),
}

/// Borrowed inputs for atomically beginning one optimistic mutation.
pub struct BeginOptimisticWrite<'a> {
    /// Local entities whose IDs must be resolved from the committed response.
    pub identity_bindings: &'a [IdentityBinding],
    /// Caller-supplied RFC UUID used only for safe coalescing.
    pub uuid: &'a str,
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
    identity_bindings: Vec<IdentityBinding>,
    identity_keys: BTreeSet<EntityKey<'static>>,
    id: OptimisticTransactionId,
    uuid: Uuid,
    superseded: bool,
    updates: RecordUpdates,
    link_patches: Vec<OptimisticLinkPatch>,
    revalidations: Vec<QueryRevalidation>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
}

struct BegunOptimisticWrite {
    transaction_id: OptimisticTransactionId,
    upsert_kind: MutationUpsertKind,
    write_result: WriteResult,
}

/// Reserved storage key holding the identity bound to this cache. The
/// `__meta:` prefix can never collide with entity keys (typenames can't
/// contain `:`).
const IDENTITY_META_KEY: &str = "__meta:identity";
const IDENTITY_VALUE_FIELD: &str = "identity";
const STORAGE_GENERATION_META_KEY: &str = "__meta:storage-generation";
const STORAGE_GENERATION_VALUE_FIELD: &str = "generation";

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

// Parsed plans contain no cached user data. Bound dynamic document churn while
// leaving room for the production operation catalog and fragment variants.
const DOCUMENT_CACHE_CAPACITY: usize = 128;

pub struct Engine<S: Storage> {
    live_queries: live_query::LiveQueries,
    query_watches: watch_query::QueryWatches,
    storage: S,
    revision: CacheRevision,
    hot: LruCache<EntityKey<'static>, Record>,
    docs: LruCache<String, Document>,
    deps: DepIndex,
    identity: IdentityState,
    /// Ordered optimistic mutation layers hydrated from durable storage.
    optimistic: Vec<OptimisticLayer>,
    optimistic_hydrated: bool,
    /// Compact durable catalogs are loaded lazily for text search. Empty
    /// queries use the storage index directly and do not populate this map.
    search_catalogs: SearchCatalogs,
}

impl<S: Storage> Engine<S> {
    pub fn new(storage: S) -> Self {
        Self::with_capacity(storage, DEFAULT_HOT_CAPACITY)
    }

    pub fn with_capacity(storage: S, hot_capacity: usize) -> Self {
        Engine {
            live_queries: live_query::LiveQueries::default(),
            query_watches: watch_query::QueryWatches::default(),
            storage,
            revision: CacheRevision::ZERO,
            hot: LruCache::new(NonZeroUsize::new(hot_capacity).expect("capacity > 0")),
            docs: LruCache::new(NonZeroUsize::new(DOCUMENT_CACHE_CAPACITY).unwrap()),
            deps: DepIndex::new(),
            identity: IdentityState::NotHydrated,
            optimistic: Vec::new(),
            optimistic_hydrated: false,
            search_catalogs: SearchCatalogs::default(),
        }
    }

    /// Returns the current effective-view revision of this engine generation.
    pub fn current_revision(&self) -> CacheRevision {
        self.revision
    }

    /// Returns the durable identity of the currently stored cache data.
    ///
    /// A fresh generation is installed when the marker is absent or malformed.
    /// Existing records are preserved when upgrading a cache without this marker.
    /// Logical clears, identity changes, and physical resets
    /// remove the marker with the data, so old hydration checkpoints cannot resume.
    /// Read storage each time: engine replacement and external resets must not
    /// leave an in-memory generation that outlives its records.
    pub async fn current_storage_generation(&mut self) -> Result<Uuid, EngineError<S::Error>> {
        let key = EntityKey(STORAGE_GENERATION_META_KEY.into());
        let fetched = self
            .storage
            .get_batch(std::slice::from_ref(&key))
            .await
            .map_err(EngineError::Storage)?;
        if let Some(record) = fetched.into_iter().next().flatten()
            && let Some(crate::value::CacheValue::String(value)) =
                record.fields.get(STORAGE_GENERATION_VALUE_FIELD)
            && let Ok(generation) = Uuid::parse_str(value)
        {
            return Ok(generation);
        }

        let generation = Uuid::now_v7();
        let mut record = Record::default();
        record.fields.insert(
            STORAGE_GENERATION_VALUE_FIELD.to_string(),
            crate::value::CacheValue::String(generation.to_string()),
        );
        self.storage
            .put_batch(vec![(key, record)])
            .await
            .map_err(EngineError::Storage)?;
        Ok(generation)
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
        self.live_queries.advance(next);
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
        let mut live_projection_keys = live_query::projection_keys(&self.optimistic);
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
        live_projection_keys.extend(live_query::projection_keys(&self.optimistic));
        let live_records = candidates.clone();
        self.optimistic_hydrated = true;
        let changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before_all.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(changed.iter());
        let revision = self.advance_revision()?;
        self.live_queries.record(
            revision,
            live_query::Changes {
                records: live_records,
                projections: live_projection_keys,
            },
        );
        Ok(WriteResult {
            field_changes: Some(crate::field_changes::between(&before_all, &after)),
            identity_errors: Vec::new(),
            revision,
            revision_advanced: true,
            search_changed_buckets: None,
            changed,
            affected_ops,
            reset: false,
            revalidations: Vec::new(),
            mutation_uuid: None,
        })
    }

    async fn rebuild_queued_layers(
        &mut self,
        queued: Vec<QueuedMutation>,
    ) -> Result<Vec<OptimisticLayer>, EngineError<S::Error>> {
        self.rebuild_queued_layers_with_strict_tail(queued, None)
            .await
    }

    async fn rebuild_queued_layers_with_strict_tail(
        &mut self,
        queued: Vec<QueuedMutation>,
        strict_tail: Option<MutationId>,
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
            let mut source = decode_optimistic_source(&queued.optimistic.optimistic_data_json)
                .map_err(|detail| EngineError::InvalidQueuedMutation {
                    id: queued.id,
                    detail: format!("invalid optimistic response: {detail}"),
                })?;
            let identities = self
                .load_identity_bindings(&source.identity_bindings)
                .await?;
            for patch in &mut source.link_patches {
                identity::remap_patch(patch, &source.identity_bindings, &identities);
            }
            for revalidation in &mut source.revalidations {
                identity::remap_variables(
                    &mut revalidation.variables_json,
                    &source.identity_bindings,
                    &identities,
                );
            }
            for projection in &mut source.projection_mutations {
                identity::remap_projection(projection, &identities);
            }
            let document = Self::document(&mut self.docs, &queued.mutation.request.query)?;
            let operation =
                document.operation(queued.mutation.request.operation_name.as_deref())?;
            let mut updates = identity::remap_updates(
                normalize(operation, &variables, &source.mutation_data)?,
                &source.identity_bindings,
                &identities,
            );
            identity::apply_record_lifecycle(&mut updates, &source.identity_bindings, &identities);
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
            // recreated from stale recipes during hydration. A newly submitted
            // tail remains strict so invalid caller patches cannot be persisted.
            apply_link_patches(
                &mut effective,
                &mut updates,
                &patches,
                strict_tail != Some(queued.id),
            )?;
            let revalidations = deduplicate_revalidations(
                source.revalidations.iter().cloned().chain(
                    source
                        .link_patches
                        .iter()
                        .filter_map(OptimisticLinkPatch::revalidation),
                ),
            );
            layers.push(OptimisticLayer {
                identity_keys: source
                    .identity_bindings
                    .iter()
                    .map(|binding| {
                        identities
                            .get(&binding.local_key)
                            .unwrap_or(&binding.local_key)
                            .clone()
                    })
                    .collect(),
                identity_bindings: source.identity_bindings,
                id: queued.id,
                uuid: queued.uuid,
                superseded: queued.superseded,
                updates,
                link_patches: patches,
                revalidations,
                projection_mutations: source.projection_mutations,
            });
        }
        Ok(layers)
    }

    async fn load_identity_bindings(
        &self,
        bindings: &[IdentityBinding],
    ) -> Result<IdentityMap, EngineError<S::Error>> {
        let keys = bindings
            .iter()
            .map(|binding| binding.local_key.clone())
            .collect::<Vec<_>>();
        if keys.is_empty() {
            return Ok(IdentityMap::new());
        }
        let mut targets = keys.clone();
        let mut visited = keys
            .iter()
            .map(|key| BTreeSet::from([key.clone()]))
            .collect::<Vec<_>>();
        for _ in 0..identity::MAX_ALIAS_CHAIN_DEPTH {
            let records = self
                .storage
                .get_batch(&targets)
                .await
                .map_err(EngineError::Storage)?;
            let mut advanced = false;
            for ((target, record), visited) in targets.iter_mut().zip(records).zip(&mut visited) {
                if let Some(next) = record.as_ref().and_then(identity::alias_target) {
                    if !visited.insert(next.clone()) {
                        return Err(EngineError::InvalidOptimisticProjection(
                            "cyclic identity binding".into(),
                        ));
                    }
                    *target = next.clone();
                    advanced = true;
                }
            }
            if !advanced {
                let mut identities = keys
                    .into_iter()
                    .zip(targets)
                    .filter(|(key, target)| key != target)
                    .collect();
                identity::expand_reference_identities(bindings, &mut identities);
                return Ok(identities);
            }
        }
        Err(EngineError::InvalidOptimisticProjection(
            "identity binding chain is too deep".into(),
        ))
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
        self.read_query_tracked(
            op_id,
            query,
            operation_name,
            variables,
            entity_resolvers,
            false,
        )
        .await
        .map(|(result, _)| result)
    }

    async fn read_query_tracked(
        &mut self,
        op_id: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        entity_resolvers: &[EntityResolver],
        track_projection: bool,
    ) -> Result<(ReadResult, Option<crate::denormalize::QueryProjection>), EngineError<S::Error>>
    {
        let entity_resolvers = EntityResolverLookup::compile(entity_resolvers)?;
        self.hydrate_optimistic().await?;
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?.prepare(variables)?;
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
        let mut deps = QueryDependencies::default();

        let mut plans = ReadPlans::default();
        let mut session = ReadSession::new(
            &EntityKey::root(),
            crate::meta::QUERY_ROOT_TYPE,
            &op.selection_set,
        );
        if track_projection {
            session.projection = Some(Default::default());
        }
        let outcome = loop {
            let source = EngineSource {
                hot: &self.hot,
                fetched: &fetched_base,
                composed: &composed,
            };
            match session.resume(variables, &source, &mut deps, &entity_resolvers, &mut plans)? {
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

        // Refresh borrowed hot records before cold promotions can evict them.
        for key in &deps.records {
            let _ = self.hot.get(key);
        }
        for (key, record) in fetched_base {
            self.hot.put(key, record);
        }
        if let Some(op_id) = op_id {
            self.deps.set_query_deps(op_id, deps);
        }
        Ok((outcome, session.projection))
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
        let (records, _) = self.read_records_tracked(selection, keys).await?;
        Ok(self.revisioned(records))
    }

    async fn read_records_tracked(
        &mut self,
        selection: &RecordSelection,
        keys: &[EntityKey<'static>],
    ) -> Result<(Vec<SelectedRecord>, live_query::RowDependencies), EngineError<S::Error>> {
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
            return Ok((Vec::new(), BTreeMap::new()));
        }
        self.hydrate_optimistic().await?;

        let selected_types: BTreeSet<_> =
            selection.type_names().iter().map(String::as_str).collect();
        let mut seen = BTreeSet::new();
        let ordered_keys: Vec<_> = keys
            .iter()
            .filter(|key| {
                key.typename()
                    .is_some_and(|name| selected_types.contains(name))
                    && seen.insert((*key).clone())
            })
            .cloned()
            .collect();
        let optimistic = merged_optimistic(&self.optimistic);
        let (projected, dependencies) = self
            .project_record_batch(selection, &ordered_keys, &optimistic)
            .await?;
        let records = projected;
        let canonical_keys = records
            .iter()
            .map(|(key, record)| {
                record
                    .get("id")
                    .and_then(Json::as_str)
                    .and_then(|id| {
                        key.typename()
                            .map(|typename| EntityKey::entity(typename, &[id]))
                    })
                    .unwrap_or_else(|| key.clone())
            })
            .collect::<Vec<_>>();
        let mutation_uuid = |record: &Record| match record.fields.get(identity::MUTATION_UUID_FIELD)
        {
            Some(crate::value::CacheValue::String(uuid)) => Some(uuid.clone()),
            _ => None,
        };
        // Projection already warmed these records. Read only identity metadata
        // from hot rows, without fetching or cloning their unselected bodies.
        let mut durable_uuids = vec![None; canonical_keys.len()];
        let mut missing = Vec::new();
        for (index, key) in canonical_keys.iter().enumerate() {
            if let Some(record) = self.hot.get(key) {
                durable_uuids[index] = mutation_uuid(record);
            } else {
                missing.push((index, key.clone()));
            }
        }
        if !missing.is_empty() {
            let keys: Vec<_> = missing.iter().map(|(_, key)| key.clone()).collect();
            let records = self
                .storage
                .get_batch(&keys)
                .await
                .map_err(EngineError::Storage)?;
            for ((index, _), record) in missing.into_iter().zip(records) {
                durable_uuids[index] = record.as_ref().and_then(mutation_uuid);
            }
        }
        let records = records
            .into_iter()
            .zip(canonical_keys)
            .zip(durable_uuids)
            .map(|(((record_key, record), canonical), durable)| {
                let pending = self
                    .optimistic
                    .iter()
                    .rev()
                    .find(|layer| layer.identity_keys.contains(&canonical));
                let mutation_uuid = pending.map(|layer| layer.uuid.to_string()).or(durable);
                SelectedRecord {
                    record_key,
                    record,
                    identity: identity::IdentityStatus {
                        mutation_uuid,
                        pending: pending.is_some(),
                    },
                }
            })
            .collect();
        Ok((records, dependencies))
    }

    async fn project_record_batch(
        &mut self,
        selection: &RecordSelection,
        candidate_keys: &[EntityKey<'static>],
        optimistic: &BTreeMap<EntityKey<'static>, Record>,
    ) -> Result<(Vec<(EntityKey<'static>, Json)>, live_query::RowDependencies), EngineError<S::Error>>
    {
        // Borrow hot bases through EngineSource, just like ordinary query reads.
        // Only cold records and optimistic compositions need owned snapshots.
        let mut fetched_base = HashMap::new();
        let mut composed = HashMap::new();
        for (key, update) in optimistic {
            if let Some(base) = self.hot.peek(key) {
                let mut effective = base.clone();
                effective.merge(update.clone());
                composed.insert(key.clone(), effective);
            }
        }

        let variables = serde_json::Map::new();
        let mut pending: BTreeMap<_, _> = candidate_keys
            .iter()
            .map(|key| {
                (
                    key.clone(),
                    ReadSession::new(
                        key,
                        key.typename().unwrap_or_default(),
                        selection.selection_set(),
                    ),
                )
            })
            .collect();
        let mut plans = ReadPlans::default();
        let mut completed = BTreeMap::new();
        let mut known_absent = BTreeSet::new();
        let mut dependencies = live_query::RowDependencies::new();
        while !pending.is_empty() {
            let mut missing = BTreeSet::new();
            let source = EngineSource {
                hot: &self.hot,
                fetched: &fetched_base,
                composed: &composed,
            };
            let current: Vec<_> = pending.keys().cloned().collect();
            for key in current {
                match pending.get_mut(&key).expect("pending record").resume(
                    &variables,
                    &source,
                    dependencies.entry(key.clone()).or_default(),
                    &EntityResolverLookup::default(),
                    &mut plans,
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

        // Keep this read's working set ahead of unrelated hot records.
        for key in dependencies.values().flatten() {
            let _ = self.hot.get(key);
        }
        for (key, record) in fetched_base {
            self.hot.put(key, record);
        }
        Ok((
            candidate_keys
                .iter()
                .filter_map(|key| completed.remove(key).map(|record| (key.clone(), record)))
                .collect(),
            dependencies,
        ))
    }

    /// Searches the compact materialized projection without scanning or
    /// decoding normalized-record payloads.
    ///
    /// Empty queries fan out over the per-profile/per-bucket timestamp index.
    /// Text queries lazily load only requested buckets and rank borrowed entries.
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

        let browse_candidates: HashMap<EntityKey<'static>, SearchDocument> =
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
                for bucket in &buckets {
                    // Unknown (but syntactically valid) buckets have no projection.
                    // Do not grow the catalog map with arbitrary empty names.
                    if !request.profile.buckets().contains(&bucket.as_str()) {
                        continue;
                    }
                    if self.search_catalogs.get(request.profile, bucket).is_none() {
                        let documents = self
                            .storage
                            .load_search_documents(request.profile, bucket)
                            .await
                            .map_err(EngineError::Storage)?;
                        self.search_catalogs
                            .insert(request.profile, bucket.clone(), documents);
                    }
                }
                HashMap::new()
            };

        let cached = buckets
            .iter()
            .filter(|_| !trimmed_query.is_empty())
            .filter_map(|bucket| self.search_catalogs.get(request.profile, bucket))
            .flat_map(|catalog| catalog.values());
        // A shadow removes its durable counterpart even when the optimistic
        // value is deleted, moved to another bucket, or excluded by the cursor.
        let candidates = browse_candidates
            .values()
            .chain(cached)
            .filter(|document| !overlay.contains_key(&document.record_key))
            .chain(overlay.values().filter_map(Option::as_ref))
            .filter(|document| bucket_set.contains(document.bucket.as_str()))
            .filter(|document| cursor_allows(request.cursor.as_ref(), document));
        Ok(rank_documents(request, candidates))
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
        self.search_catalogs.update(entries);
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
        self.write_network(origin_op, registration, input, projections, true)
            .await
            .map(|(result, _)| result)
    }

    async fn write_network(
        &mut self,
        origin_op: Option<OpId>,
        registration: Option<QueryRegistration<'_>>,
        input: NetworkWrite<'_>,
        projections: Vec<ProjectionMutation>,
        retain_pages: bool,
    ) -> Result<(WriteResult, BTreeSet<String>), EngineError<S::Error>> {
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
        let is_query = op.kind == OperationKind::Query;
        let normalized = normalize_with_dependencies(op, variables, data, &entity_resolvers)?;
        let mut updates = normalized.updates;
        if !retain_pages {
            crate::page_retention::omit_hydration_pages(&mut updates);
        }

        let mut reset = false;
        if let Some(observed) = identity {
            match self.bound_identity().await? {
                IdentityState::NotHydrated => unreachable!("bound_identity hydrates"),
                IdentityState::Missing => self.bind_identity(observed).await?,
                IdentityState::Bound(bound) if bound == observed => {}
                IdentityState::Bound(_) => {
                    self.hot.clear();
                    self.live_queries = live_query::LiveQueries::default();
                    self.query_watches = watch_query::QueryWatches::default();
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

        // Without optimistic layers, durable changes are exactly the visible
        // changes. Avoid loading/cloning the whole batch again on both sides
        // of an ordinary network refresh.
        let optimistic_before = if self.optimistic.is_empty() {
            None
        } else {
            let mut candidates = layer_keys(&self.optimistic);
            candidates.extend(updates.keys().cloned());
            let bases = self.load_bases(&candidates).await?;
            let before = effective_records(&bases, &self.optimistic, &candidates);
            Some((candidates, before))
        };
        let PersistedChanges {
            mut field_changes,
            changed,
            mut revision,
            mut revision_advanced,
            mut search_changed_buckets,
            viewer_fields: mut viewer_changes,
        } = self.persist_updates(updates, projections).await?;
        if reset && !revision_advanced {
            revision = self.advance_revision()?;
            revision_advanced = true;
        }

        let visible_changed = if let Some((mut candidates, before)) = optimistic_before {
            let queued = self
                .storage
                .load_mutation_queue()
                .await
                .map_err(EngineError::Storage)?;
            self.optimistic = self.rebuild_queued_layers(queued).await?;
            candidates.extend(layer_keys(&self.optimistic));
            let bases_after = self.load_bases(&candidates).await?;
            let after = effective_records(&bases_after, &self.optimistic, &candidates);
            field_changes = crate::field_changes::between(&before, &after);
            if revision_advanced {
                self.live_queries.extend(
                    revision,
                    candidates.iter().cloned(),
                    live_query::projection_keys(&self.optimistic),
                );
            }
            // Compare the composed view: a hydration hidden beneath a pending
            // edit must not invalidate the search projection it did not change.
            search_changed_buckets.clear();
            viewer_changes.clear();
            for key in &candidates {
                if let Some(fields) = changed_viewer_fields(
                    before.get(key).and_then(Option::as_ref),
                    after.get(key).and_then(Option::as_ref),
                ) {
                    viewer_changes.insert(key.clone(), fields);
                }
                collect_search_changes(
                    key,
                    before.get(key).and_then(Option::as_ref),
                    after.get(key).and_then(Option::as_ref),
                    &mut search_changed_buckets,
                );
            }
            candidates
                .into_iter()
                .filter(|key| before.get(key) != after.get(key))
                .collect()
        } else {
            changed.clone()
        };

        let mut affected_ops = if reset {
            // Everything anyone had cached is gone: re-execute all ops.
            self.deps.all_ops()
        } else if is_query {
            self.deps.ops_for_changes(&visible_changed, &viewer_changes)
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
                    .set_query_deps(registration.op_id, normalized.dependencies);
            } else {
                self.deps.set_op_broad(registration.op_id);
            }
        }
        Ok((
            WriteResult {
                field_changes: (!reset).then_some(field_changes),
                identity_errors: Vec::new(),
                mutation_uuid: None,
                revision,
                revision_advanced,
                search_changed_buckets: (is_query && !reset)
                    .then(|| search_changed_buckets.clone()),
                changed,
                affected_ops,
                reset,
                revalidations: Vec::new(),
            },
            search_changed_buckets,
        ))
    }

    /// Stores a network response and returns only fields not marked
    /// `@cacheOnly`. Projection is taken directly from the validated network
    /// payload, so hydration never denormalizes the response back out of
    /// storage. Soup page wrappers are transient; their normalized descendants
    /// and projections are persisted without retaining cursor-qualified pages.
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
            project_hydration_response(&op.prepare(variables)?, data)?
        };
        let (write_result, search_changed_buckets) = self
            .write_network(
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
                false,
            )
            .await?;
        Ok(HydrationWriteResult {
            write_result,
            search_changed_buckets,
            data: projected,
        })
    }

    /// Merges normalized updates into the hot tier and storage. Returns the
    /// keys whose durable contents actually changed.
    async fn persist_updates(
        &mut self,
        updates: RecordUpdates,
        projections: Vec<ProjectionMutation>,
    ) -> Result<PersistedChanges, EngineError<S::Error>> {
        let projection_keys = projections
            .iter()
            .map(|mutation| mutation.record_key().clone())
            .collect();
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
        let mut field_changes = Vec::new();
        let mut search_changed_buckets = BTreeSet::new();
        let mut viewer_fields = ViewerFields::new();
        let mut to_persist: Vec<(EntityKey<'static>, Record)> = Vec::new();
        let mut touched = Vec::with_capacity(updates.len());
        for (key, update) in updates {
            let (merged, did_change) = match staging.remove(&key) {
                Some(mut existing) => {
                    // Compare only fields supplied by this partial response,
                    // overlaid onto the existing row, without cloning its body.
                    let before = snapshot_search_fields(&key, &existing);
                    let viewer_update = ViewerFieldUpdate::capture(&existing, &update);
                    field_changes
                        .extend(crate::field_changes::from_update(&key, &existing, &update));
                    let did_change = existing.merge(update);
                    if let Some(fields) = viewer_update.and_then(|update| update.finish(&existing))
                    {
                        viewer_fields.insert(key.clone(), fields);
                    }
                    if did_change {
                        collect_search_changes(
                            &key,
                            before.as_ref(),
                            Some(&existing),
                            &mut search_changed_buckets,
                        );
                    }
                    (existing, did_change)
                }
                None => {
                    field_changes.push(crate::field_changes::RecordFieldChange::Invalidate {
                        key: key.clone(),
                    });
                    collect_search_changes(&key, None, Some(&update), &mut search_changed_buckets);
                    (update, true)
                }
            };
            if did_change {
                changed.insert(key.clone());
                to_persist.push((key.clone(), merged.clone()));
            }
            touched.push((key, merged));
        }

        // Unchanged bases are already durable, including those fetched after
        // hot-tier eviction. Still apply every projection mutation: a partial
        // response can change projection authority without changing records.
        let revision_advanced = if changed.is_empty() {
            self.projection_mutations_change(&projections).await?
        } else {
            true
        };
        self.storage
            .put_batch_with_projections(to_persist, projections)
            .await
            .map_err(EngineError::Storage)?;
        let revision = if revision_advanced {
            self.advance_revision()?
        } else {
            self.revision
        };
        if revision_advanced {
            self.live_queries.record(
                revision,
                live_query::Changes {
                    records: changed.clone(),
                    projections: projection_keys,
                },
            );
        }
        // Publish only after the atomic write succeeds. Otherwise a failed
        // write could poison the hot tier and make its retry look unchanged.
        self.update_loaded_search_catalogs(&touched);
        for (key, record) in touched {
            self.hot.put(key, record);
        }
        Ok(PersistedChanges {
            field_changes,
            changed,
            revision,
            revision_advanced,
            search_changed_buckets,
            viewer_fields,
        })
    }

    async fn projection_mutations_change(
        &self,
        mutations: &[ProjectionMutation],
    ) -> Result<bool, EngineError<S::Error>> {
        if mutations.is_empty() {
            return Ok(false);
        }
        let keys = mutations
            .iter()
            .map(ProjectionMutation::record_key)
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let states = self
            .storage
            .load_projection_states(&keys)
            .await
            .map_err(EngineError::Storage)?;
        let mut projected = keys
            .into_iter()
            .zip(states)
            .filter_map(|(key, state)| state.map(|state| (key, state)))
            .collect::<HashMap<_, _>>();
        let before = projected.clone();
        apply_authoritative_projection_mutations(&mut projected, mutations);
        Ok(projected != before)
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
        let begun = self
            .upsert_optimistic_write(origin_op, input, projection_mutations)
            .await?;
        Ok((begun.transaction_id, begun.write_result))
    }

    async fn upsert_optimistic_write(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
        projection_mutations: Vec<OptimisticProjectionMutation>,
    ) -> Result<BegunOptimisticWrite, EngineError<S::Error>> {
        let uuid = Uuid::parse_str(input.uuid)
            .map_err(|_| EngineError::InvalidMutationUuid(input.uuid.to_owned()))?;
        self.ensure_revision_can_advance()?;
        let mut live_projection_keys = live_query::projection_keys(&self.optimistic);
        let BeginOptimisticWrite {
            uuid: _,
            query,
            operation_name,
            variables,
            data,
            link_patches,
            revalidations,
            created_at_ms,
            identity_bindings,
        } = input;
        identity::validate(identity_bindings).map_err(EngineError::InvalidOptimisticProjection)?;
        self.hydrate_optimistic().await?;

        let queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        let expected_queue = queued
            .iter()
            .map(MutationQueueSnapshot::from)
            .collect::<Vec<_>>();
        let old_layers = self.rebuild_queued_layers(queued.clone()).await?;
        let collision = queued
            .iter()
            .find(|queued| queued.uuid == uuid && !queued.superseded)
            .map(|queued| {
                (
                    queued.id,
                    crate::queue::collision_stays_active(
                        queued.mutation.lease_expires_at_ms,
                        created_at_ms,
                        queued.mutation.attempt_count > 0,
                        &queued.optimistic.optimistic_data_json,
                    ),
                )
            });
        let expected_kind = match collision {
            None => MutationUpsertKind::Inserted,
            Some((active_id, true)) => MutationUpsertKind::AppendedAfterActive { active_id },
            Some((removed_id, false)) => MutationUpsertKind::ReplacedPending { removed_id },
        };

        let patches = deduplicate_patches(link_patches)?;
        let revalidations = deduplicate_revalidations(
            revalidations
                .iter()
                .cloned()
                .chain(patches.iter().filter_map(OptimisticLinkPatch::revalidation)),
        );
        for mutation in &projection_mutations {
            mutation
                .validate()
                .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?;
        }
        let identity = match self.bound_identity().await? {
            IdentityState::Bound(identity) => Some(identity),
            IdentityState::NotHydrated | IdentityState::Missing => None,
        };
        let source = OptimisticSource {
            identity_bindings: identity_bindings.to_vec(),
            mutation_data: data.clone(),
            link_patches: patches,
            revalidations,
            projection_mutations,
        };
        let mut entry = NewQueuedMutation {
            uuid,
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
                normalized_updates: RecordUpdates::default(),
            },
        };

        let mut proposed_queue = queued.clone();
        match expected_kind {
            MutationUpsertKind::Inserted => {}
            MutationUpsertKind::ReplacedPending { removed_id } => {
                proposed_queue.retain(|queued| queued.id != removed_id);
            }
            MutationUpsertKind::AppendedAfterActive { active_id } => {
                proposed_queue
                    .iter_mut()
                    .find(|queued| queued.id == active_id)
                    .expect("collision was loaded")
                    .superseded = true;
            }
        }
        proposed_queue.push(QueuedMutation {
            id: MutationId::MAX,
            uuid,
            superseded: false,
            mutation: entry.mutation.clone(),
            optimistic: entry.optimistic.clone(),
        });
        let mut proposed_layers = self
            .rebuild_queued_layers_with_strict_tail(proposed_queue, Some(MutationId::MAX))
            .await?;
        entry.optimistic.normalized_updates = proposed_layers
            .last()
            .expect("proposed queue contains the new tail")
            .updates
            .clone();

        let mut candidates = layer_keys(&old_layers);
        candidates.extend(layer_keys(&proposed_layers));
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &old_layers, &candidates);
        let after = effective_records(&bases, &proposed_layers, &candidates);

        let affected_projection_keys = old_layers
            .iter()
            .chain(&proposed_layers)
            .flat_map(|layer| &layer.projection_mutations)
            .map(|mutation| mutation.record_key().clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let authoritative = self
            .storage
            .load_projection_states(&affected_projection_keys)
            .await
            .map_err(EngineError::Storage)?;
        if authoritative.len() != affected_projection_keys.len() {
            return Err(EngineError::InvalidOptimisticProjection(
                "storage returned misaligned authoritative projection states".to_owned(),
            ));
        }
        let projection_layers = proposed_layers
            .iter()
            .map(|layer| ProjectionMutationLayer {
                owner: layer.id,
                mutations: &layer.projection_mutations,
            })
            .collect::<Vec<_>>();
        let replacements = affected_projection_keys
            .iter()
            .zip(authoritative.iter())
            .filter_map(|(key, authoritative)| {
                compose_effective_optimistic_projection(
                    key,
                    authoritative.as_ref(),
                    &projection_layers,
                )
                .transpose()
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?
            .into_iter()
            .map(|projection| StagedOptimisticProjection {
                owner: if projection.owner == MutationId::MAX {
                    StagedOptimisticProjectionOwner::Enqueued
                } else {
                    StagedOptimisticProjectionOwner::Existing(projection.owner)
                },
                state: projection.state,
                uncertainty: projection.uncertainty,
            })
            .collect();
        let upsert = self
            .storage
            .upsert_mutation_with_shadow(
                entry,
                created_at_ms,
                OptimisticUpsertReconciliation {
                    expected_queue: Some(expected_queue),
                    affected_keys: affected_projection_keys,
                    replacements,
                },
            )
            .await
            .map_err(EngineError::Storage)?;
        if upsert.kind != expected_kind {
            return Err(EngineError::StaleOptimisticUpsert);
        }
        proposed_layers
            .last_mut()
            .expect("proposed queue contains the new tail")
            .id = upsert.id;
        self.optimistic = proposed_layers;
        live_projection_keys.extend(live_query::projection_keys(&self.optimistic));
        let live_records = candidates.clone();

        let changed = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect::<BTreeSet<_>>();
        let mut affected_ops = self.deps.ops_for_keys(changed.iter());
        if let Some(origin) = origin_op {
            affected_ops.remove(&origin);
        }
        let revision = self.advance_revision()?;
        self.live_queries.record(
            revision,
            live_query::Changes {
                records: live_records,
                projections: live_projection_keys,
            },
        );
        Ok(BegunOptimisticWrite {
            transaction_id: upsert.id,
            upsert_kind: upsert.kind,
            write_result: WriteResult {
                field_changes: Some(crate::field_changes::between(&before, &after)),
                identity_errors: Vec::new(),
                revision,
                revision_advanced: true,
                search_changed_buckets: None,
                changed,
                affected_ops,
                reset: false,
                revalidations: Vec::new(),
                mutation_uuid: None,
            },
        })
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
        let begun = self
            .upsert_optimistic_write(origin_op, input, projection_mutations)
            .await?;
        let initial_claim = match self.claim_next_mutation(claim).await {
            Ok(Some(claimed)) => InitialClaimOutcome::Claimed(Box::new(claimed)),
            Ok(None) => InitialClaimOutcome::NotRunnable,
            Err(error) => InitialClaimOutcome::Failed(error),
        };
        Ok(EnqueueOptimisticMutationResult {
            transaction_id: begun.transaction_id,
            upsert_kind: begun.upsert_kind,
            write_result: begun.write_result,
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

    /// Releases a retryable mutation, or discards it when a newer UUID match exists.
    pub async fn defer_optimistic_write(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<DeferOptimisticWriteResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let layer = self
            .optimistic
            .iter()
            .find(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        if layer.superseded
            && !layer
                .identity_bindings
                .iter()
                .any(|binding| !binding.response_path.is_empty())
        {
            let replacement_transaction_id = self
                .optimistic
                .iter()
                .find(|candidate| candidate.uuid == layer.uuid && !candidate.superseded)
                .map(|candidate| candidate.id)
                .ok_or(EngineError::UnknownTransaction(transaction))?;
            let write_result = self.rollback_optimistic_write(transaction, claim).await?;
            return Ok(DeferOptimisticWriteResult::DiscardedSuperseded(
                SupersededMutationResult {
                    write_result,
                    replacement_transaction_id,
                },
            ));
        }
        if !self
            .storage
            .defer_mutation(transaction, claim, next_attempt_at_ms, error)
            .await
            .map_err(EngineError::Storage)?
        {
            return Err(EngineError::StaleMutationClaim(transaction));
        }
        Ok(DeferOptimisticWriteResult::Deferred)
    }

    async fn stage_shadow_reconciliation(
        &self,
        transaction: OptimisticTransactionId,
        authoritative_mutations: &[ProjectionMutation],
        identities: &IdentityMap,
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
        let mut rebased_layers = self.optimistic.clone();
        for layer in &mut rebased_layers {
            for projection in &mut layer.projection_mutations {
                identity::remap_projection(projection, identities);
            }
        }
        let affected_keys = settled
            .projection_mutations
            .iter()
            .map(|mutation| mutation.record_key().clone())
            .chain(
                authoritative_mutations
                    .iter()
                    .map(|mutation| mutation.record_key().clone()),
            )
            .chain(
                self.optimistic
                    .iter()
                    .chain(&rebased_layers)
                    .flat_map(|layer| {
                        layer
                            .projection_mutations
                            .iter()
                            .map(|mutation| mutation.record_key().clone())
                    }),
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
                ProjectionMutation::Patch {
                    record_key,
                    profile,
                    partition,
                    exact,
                    integers,
                    sorts,
                } => {
                    let state = apply_authoritative_projection_patch(
                        authoritative.get(record_key).and_then(Option::as_ref),
                        record_key,
                        profile,
                        partition,
                        exact,
                        integers,
                        sorts,
                    );
                    authoritative.insert(record_key.clone(), Some(state));
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
                ProjectionMutation::PatchExact {
                    record_key,
                    profile,
                    partition,
                    remove,
                    insert,
                } => {
                    let state = apply_authoritative_exact_members(
                        authoritative.get(record_key).and_then(Option::as_ref),
                        record_key,
                        profile,
                        partition,
                        remove,
                        insert,
                    );
                    authoritative.insert(record_key.clone(), Some(state));
                }
            }
        }
        let remaining_layers = rebased_layers
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
    /// Invalid response identities are reported in [`WriteResult::identity_errors`].
    /// If that response also cannot normalize, the attempt is discarded and
    /// [`EngineError::IdentityResolutionFailed`] carries the rollback changes.
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

    /// Commits an optimistic write and reports whether a newer UUID match superseded it.
    #[allow(clippy::too_many_arguments)]
    pub async fn commit_optimistic_write_with_outcome(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
    ) -> Result<CommitOptimisticWriteResult, EngineError<S::Error>> {
        self.commit_optimistic_write_with_projections_outcome(
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

    /// Commits an optimistic write with projections and reports supersession.
    #[allow(clippy::too_many_arguments)]
    pub async fn commit_optimistic_write_with_projections_outcome(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
        projections: Vec<ProjectionMutation>,
    ) -> Result<CommitOptimisticWriteResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let layer = self
            .optimistic
            .iter()
            .find(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let replacement_transaction_id = if layer.superseded {
            Some(
                self.optimistic
                    .iter()
                    .find(|candidate| candidate.uuid == layer.uuid && !candidate.superseded)
                    .map(|candidate| candidate.id)
                    .ok_or(EngineError::UnknownTransaction(transaction))?,
            )
        } else {
            None
        };
        let write_result = match self
            .commit_optimistic_write_with_projections(
                transaction,
                claim,
                query,
                operation_name,
                variables,
                data,
                projections,
            )
            .await
        {
            Ok(result) => result,
            Err(EngineError::IdentityResolutionFailed(result)) => {
                return Ok(CommitOptimisticWriteResult::Failed(*result));
            }
            Err(error) => return Err(error),
        };
        match replacement_transaction_id {
            Some(replacement_transaction_id) => Ok(
                CommitOptimisticWriteResult::CommittedSuperseded(SupersededMutationResult {
                    write_result,
                    replacement_transaction_id,
                }),
            ),
            None => Ok(CommitOptimisticWriteResult::Committed(write_result)),
        }
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
        let mut live_projection_keys = live_query::projection_keys(&self.optimistic);
        live_projection_keys.extend(
            projections
                .iter()
                .map(|projection| projection.record_key().clone()),
        );
        self.hydrate_optimistic().await?;
        let index = self
            .optimistic
            .iter()
            .position(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let mutation_uuid = Some(self.optimistic[index].uuid.to_string());
        let mut bindings = self.optimistic[index].identity_bindings.clone();
        let mut identity_errors = Vec::new();
        let identities = match identity::resolve(&bindings, data) {
            Ok(identities) => identities,
            Err(_) => {
                // Salvage valid bindings without guessing targets for failed ones.
                let mut identities = IdentityMap::new();
                bindings.retain(|binding| {
                    match identity::resolve(std::slice::from_ref(binding), data) {
                        Ok(resolved) => {
                            identities.extend(resolved);
                            true
                        }
                        Err(error) => {
                            identity_errors.push(error);
                            false
                        }
                    }
                });
                identities
            }
        };
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let mut updates = match normalize(op, variables, data) {
            Ok(updates) => updates,
            Err(error) if identity_errors.is_empty() => return Err(error.into()),
            Err(error) => {
                // No safe authoritative write is possible. Retire this attempt
                // rather than replaying an already successful server mutation.
                let error = format!("{}; {error}", identity_errors.join("; "));
                let rollback = self
                    .rollback_optimistic_write_with_outcome(transaction, claim)
                    .await?;
                let (write_result, replacement_transaction_id) = match rollback {
                    RollbackOptimisticWriteResult::RolledBack(result) => (result, None),
                    RollbackOptimisticWriteResult::DiscardedSuperseded(result) => {
                        (result.write_result, Some(result.replacement_transaction_id))
                    }
                };
                return Err(EngineError::IdentityResolutionFailed(Box::new(
                    FailedMutationResult {
                        write_result,
                        error,
                        replacement_transaction_id,
                    },
                )));
            }
        };
        // Recipes and revalidation variables may contain unresolved local IDs.
        // On a binding error, commit only authoritative data and valid aliases.
        let (mut recipes, mut revalidations) = if identity_errors.is_empty() {
            (
                self.optimistic[index].link_patches.clone(),
                self.optimistic[index].revalidations.clone(),
            )
        } else {
            (Vec::new(), Vec::new())
        };
        for patch in &mut recipes {
            identity::remap_patch(patch, &bindings, &identities);
        }
        for revalidation in &mut revalidations {
            identity::remap_variables(&mut revalidation.variables_json, &bindings, &identities);
        }
        for (local, target) in &identities {
            if !updates.contains_key(target) {
                if bindings.iter().any(|binding| &binding.local_key == local) {
                    return Err(EngineError::InvalidOptimisticProjection(
                        "identity target is absent from normalized response".into(),
                    ));
                }
                continue;
            }
            updates.insert(local.clone(), identity::alias_record(target));
            updates.entry(target.clone()).or_default().fields.insert(
                identity::MUTATION_UUID_FIELD.into(),
                crate::value::CacheValue::String(self.optimistic[index].uuid.to_string()),
            );
        }

        let stored_identities = self.load_identity_bindings(&bindings).await?;
        let mut settled_identities = stored_identities;
        settled_identities.extend(identities.clone());
        identity::apply_record_lifecycle(&mut updates, &bindings, &settled_identities);
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
            .stage_shadow_reconciliation(transaction, &projections, &identities)
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
        live_projection_keys.extend(live_query::projection_keys(&self.optimistic));
        let live_records = candidates.clone();
        let visible_changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(visible_changed.iter());
        self.live_queries.record(
            revision,
            live_query::Changes {
                records: live_records,
                projections: live_projection_keys,
            },
        );
        Ok(WriteResult {
            field_changes: Some(crate::field_changes::between(&before, &after)),
            identity_errors,
            revision,
            revision_advanced: true,
            search_changed_buckets: None,
            changed: durable_changed,
            affected_ops,
            reset: false,
            revalidations,
            mutation_uuid,
        })
    }

    /// Permanently fails the claimed head with an explicit supersession outcome.
    pub async fn rollback_optimistic_write_with_outcome(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
    ) -> Result<RollbackOptimisticWriteResult, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let layer = self
            .optimistic
            .iter()
            .find(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let replacement_transaction_id = if layer.superseded {
            Some(
                self.optimistic
                    .iter()
                    .find(|candidate| candidate.uuid == layer.uuid && !candidate.superseded)
                    .map(|candidate| candidate.id)
                    .ok_or(EngineError::UnknownTransaction(transaction))?,
            )
        } else {
            None
        };
        let write_result = self.rollback_optimistic_write(transaction, claim).await?;
        match replacement_transaction_id {
            Some(replacement_transaction_id) => Ok(
                RollbackOptimisticWriteResult::DiscardedSuperseded(SupersededMutationResult {
                    write_result,
                    replacement_transaction_id,
                }),
            ),
            None => Ok(RollbackOptimisticWriteResult::RolledBack(write_result)),
        }
    }

    /// Permanently fails the claimed head, atomically removing its queue row
    /// and optimistic layer.
    pub async fn rollback_optimistic_write(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let mut live_projection_keys = live_query::projection_keys(&self.optimistic);
        self.hydrate_optimistic().await?;
        let layer = self
            .optimistic
            .iter()
            .find(|layer| layer.id == transaction)
            .ok_or(EngineError::UnknownTransaction(transaction))?;
        let mutation_uuid = Some(layer.uuid.to_string());
        // Failure can mean the server changed elsewhere (for example a draft
        // was sent). Hydration already rebased these durable query variables.
        let revalidations = layer.revalidations.clone();
        let mut candidates = layer_keys(&self.optimistic);
        let bases = self.load_bases(&candidates).await?;
        let before = effective_records(&bases, &self.optimistic, &candidates);
        let reconciliation = self
            .stage_shadow_reconciliation(transaction, &[], &IdentityMap::new())
            .await?;
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
        live_projection_keys.extend(live_query::projection_keys(&self.optimistic));
        let live_records = candidates.clone();
        let visible_changed: BTreeSet<EntityKey<'static>> = candidates
            .into_iter()
            .filter(|key| before.get(key) != after.get(key))
            .collect();
        let affected_ops = self.deps.ops_for_keys(visible_changed.iter());
        self.live_queries.record(
            revision,
            live_query::Changes {
                records: live_records,
                projections: live_projection_keys,
            },
        );
        Ok(WriteResult {
            field_changes: Some(crate::field_changes::between(&before, &after)),
            identity_errors: Vec::new(),
            revision,
            revision_advanced: true,
            search_changed_buckets: None,
            changed: BTreeSet::new(),
            affected_ops,
            reset: false,
            revalidations,
            mutation_uuid,
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
        candidates.extend(patches.iter().map(OptimisticLinkPatch::root_key));
        loop {
            let bases = self.load_bases(&candidates).await?;
            let composed = effective_records(&bases, layers, &candidates);
            let mut effective = present_records(composed);
            merge_updates_into_effective(&mut effective, pending_updates);
            // Inserted references validate against a loaded record, so a
            // patch referencing a durable entity absent from the updates
            // must pull that entity's base in too. A genuinely record-less
            // key stays absent after loading and the filter below stops the
            // loop from retrying it.
            let missing: BTreeSet<_> = patches
                .iter()
                .flat_map(|patch| missing_patch_records(&effective, patch))
                .chain(patches.iter().filter_map(|patch| {
                    let inserted = patch.operation.inserted_entity_key()?;
                    (!effective.contains_key(inserted)).then(|| inserted.clone())
                }))
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
        self.live_queries = live_query::LiveQueries::default();
        self.query_watches = watch_query::QueryWatches::default();
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
        self.query_watches.remove(op_id);
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
            self.search_catalogs.remove(key);
        }
        self.advance_revision()?;
        Ok(self.revisioned(affected))
    }

    /// Drops all cached state (for example, on logout), including any pending
    /// optimistic layers.
    pub async fn clear(&mut self) -> Result<CacheRevision, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.hot.clear();
        self.live_queries = live_query::LiveQueries::default();
        self.query_watches = watch_query::QueryWatches::default();
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

    /// Memoized document parse. Takes the cache (not `&mut self`) so callers
    /// can keep the returned borrow while using other engine fields.
    fn document<'d>(
        docs: &'d mut LruCache<String, Document>,
        query: &str,
    ) -> Result<&'d Document, DocumentError> {
        docs.try_get_or_insert_ref(query, || Document::parse(query))
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
        let PersistedChanges {
            field_changes,
            changed,
            revision,
            revision_advanced,
            ..
        } = self.persist_updates(updates, projections).await?;
        let mut affected_ops = self.deps.ops_for_keys(changed.iter());
        if let Some(origin_op) = origin_op {
            affected_ops.remove(&origin_op);
        }
        Ok(WriteResult {
            field_changes: self.optimistic.is_empty().then_some(field_changes),
            identity_errors: Vec::new(),
            revision,
            revision_advanced,
            search_changed_buckets: None,
            changed,
            affected_ops,
            reset: false,
            revalidations: Vec::new(),
            mutation_uuid: None,
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
        self.delete_keys_with_projection_changes(
            keys,
            projection_keys
                .iter()
                .cloned()
                .map(ProjectionMutation::Delete)
                .collect(),
        )
        .await
    }

    /// Atomically delete records and update projections that depend on them.
    pub async fn delete_keys_with_projection_changes(
        &mut self,
        keys: &[EntityKey<'static>],
        projections: Vec<ProjectionMutation>,
    ) -> Result<Revisioned<BTreeSet<OpId>>, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        let affected = self.deps.ops_for_keys(keys.iter());
        self.storage
            .delete_batch_with_projection_changes(keys, projections)
            .await
            .map_err(EngineError::Storage)?;
        for key in keys {
            self.hot.pop(key);
            self.search_catalogs.remove(key);
        }
        self.advance_revision()?;
        Ok(self.revisioned(affected))
    }

    /// Reconcile server-page membership and local candidates at one engine revision.
    pub async fn reconcile_predicate_index(
        &mut self,
        query: &ValidatedIndexQuery,
        baseline: &[PredicateBaselineEntry],
    ) -> Result<Revisioned<PredicateReconciliation>, EngineError<S::Error>> {
        if baseline.len() > MAX_RECONCILIATION_BASELINE {
            return Err(RecordSelectionError::TooManyKeys {
                count: baseline.len(),
                max: MAX_RECONCILIATION_BASELINE,
            }
            .into());
        }
        let value = self
            .storage
            .reconcile_predicate_index(query, baseline)
            .await
            .map_err(EngineError::Storage)?;
        Ok(self.revisioned(value))
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
