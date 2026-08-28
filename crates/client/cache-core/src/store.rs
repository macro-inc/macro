//! Storage abstraction: the cold tier behind the in-memory hot tier.
//!
//! Implementations: in-memory (tests) and Turso over OPFS (browser) or native
//! filesystem IO (Tauri). Futures are [`MaybeSend`]: `Send` on native targets (so
//! hosts can drive the engine from a multi-threaded runtime), unbounded on
//! wasm — wasm futures aren't
//! `Send`.

use crate::predicate::{
    OptimisticShadowReconciliation, PredicateIndexStorage, PredicateQueryResult,
    ProjectionMutation, ProjectionState,
};
use crate::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, NewQueuedMutation,
    QueuedMutation,
};
use crate::search::{SearchCursor, SearchDocument, SearchProfile, project_search_documents};
use crate::value::{EntityKey, Record};
use maybe_send::MaybeSend;
use predicate_index::{
    EffectiveOptimisticProjection, IndexDocument, PendingOptimisticProjection,
    RecordKey as PredicateRecordKey, evaluate_reference,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Whether a storage implementation can provide queue diagnostics.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum QueueDiagnosticsAvailability {
    /// This compatibility implementation has no authoritative diagnostics.
    #[default]
    Unavailable,
    /// The depth and oldest timestamp were read from authoritative storage.
    Available,
}

/// Payload-free durable mutation queue diagnostics.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct QueueDiagnostics {
    /// Whether the numeric snapshot is authoritative.
    pub availability: QueueDiagnosticsAvailability,
    /// Number of durable mutations waiting for settlement.
    pub depth: u64,
    /// Oldest durable enqueue timestamp, or `None` when the queue is empty.
    pub oldest_created_at_ms: Option<i64>,
}

/// Async KV over normalized records. Batch-oriented by design: the engine
/// issues one `get_batch` per denormalization round, never per record.
pub trait Storage: MaybeSend {
    type Error: std::error::Error + MaybeSend + 'static;

    /// Fetches records; result is aligned with `keys` (`None` = absent).
    fn get_batch(
        &self,
        keys: &[EntityKey<'_>],
    ) -> impl Future<Output = Result<Vec<Option<Record>>, Self::Error>> + MaybeSend;

    /// Upserts records atomically (all-or-nothing per batch).
    fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Atomically upserts records and generic projection lifecycle changes.
    fn put_batch_with_projections(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Deletes records (absent keys are ignored).
    fn delete_batch(
        &mut self,
        keys: &[EntityKey<'static>],
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Loads the compact catalog for text search. This must read only the
    /// derived search table, never normalized record payloads.
    fn load_search_documents(
        &self,
        _profile: SearchProfile,
    ) -> impl Future<Output = Result<Vec<SearchDocument>, Self::Error>> + MaybeSend {
        async { Ok(Vec::new()) }
    }

    /// Reads one bucket in indexed recent order. `after` is exclusive.
    fn browse_search_documents(
        &self,
        _profile: SearchProfile,
        _bucket: &str,
        _after: Option<&SearchCursor>,
        _limit: usize,
    ) -> impl Future<Output = Result<Vec<SearchDocument>, Self::Error>> + MaybeSend {
        async { Ok(Vec::new()) }
    }

    /// Atomically appends a mutation and its optimistic layer to the queue.
    fn enqueue_mutation(
        &mut self,
        entry: NewQueuedMutation,
    ) -> impl Future<Output = Result<MutationId, Self::Error>> + MaybeSend {
        self.enqueue_mutation_with_shadow(entry, Vec::new())
    }

    /// Atomically appends a mutation, its layer, and effective shadow replacements.
    ///
    /// Storage binds every pending projection to the mutation ID assigned in
    /// this transaction. Existing shadows for the pending record keys are
    /// replaced; all other shadows remain byte-for-byte unchanged.
    fn enqueue_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        projections: Vec<PendingOptimisticProjection>,
    ) -> impl Future<Output = Result<MutationId, Self::Error>> + MaybeSend;

    /// Loads authoritative projection states aligned with `keys`.
    fn load_projection_states(
        &self,
        keys: &[PredicateRecordKey],
    ) -> impl Future<Output = Result<Vec<Option<ProjectionState>>, Self::Error>> + MaybeSend {
        async { Ok(vec![None; keys.len()]) }
    }

    /// Loads current effective optimistic shadows aligned with `keys`.
    fn load_optimistic_projections(
        &self,
        keys: &[PredicateRecordKey],
    ) -> impl Future<Output = Result<Vec<Option<EffectiveOptimisticProjection>>, Self::Error>> + MaybeSend
    {
        async { Ok(vec![None; keys.len()]) }
    }

    /// Loads the complete mutation queue in ascending id order.
    fn load_mutation_queue(
        &self,
    ) -> impl Future<Output = Result<Vec<QueuedMutation>, Self::Error>> + MaybeSend;

    /// Returns only queue depth and the oldest enqueue timestamp.
    ///
    /// The default preserves source compatibility for external storage
    /// implementations and explicitly reports diagnostics as unavailable.
    /// Production backends override it with an authoritative aggregate query.
    fn queue_diagnostics(
        &self,
    ) -> impl Future<Output = Result<QueueDiagnostics, Self::Error>> + MaybeSend {
        async { Ok(QueueDiagnostics::default()) }
    }

    /// Claims the oldest mutation when it is runnable and not actively leased.
    /// Later mutations are never skipped.
    fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> impl Future<Output = Result<Option<ClaimedMutation>, Self::Error>> + MaybeSend;

    /// Retains a retryable mutation and its optimistic layer, releases its
    /// lease, and records the next eligible attempt time. Returns `false`
    /// when the claim is stale.
    fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend;

    /// Atomically writes the real response records and removes the mutation
    /// plus optimistic layer. Returns `false` when the claim is stale.
    fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend;

    /// Atomically settles a mutation with real records and projection changes.
    fn complete_mutation_with_projections(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend;

    /// Atomically commits authority, removes the strict head, and reconciles shadows.
    fn complete_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
        reconciliation: OptimisticShadowReconciliation,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend {
        let _ = reconciliation;
        self.complete_mutation_with_projections(id, claim, entries, projections)
    }

    /// Atomically removes a permanently failed mutation and its optimistic
    /// layer. Returns `false` when the claim is stale.
    fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend;

    /// Atomically removes the strict head and reconciles affected shadows.
    fn discard_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        reconciliation: OptimisticShadowReconciliation,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend {
        let _ = reconciliation;
        self.discard_mutation(id, claim)
    }

    /// Drops records, queued mutations, and optimistic layers (logout or
    /// identity mismatch).
    fn clear(&mut self) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;
}

/// Hash-map storage for tests and as the Phase 1 default.
#[derive(Clone, Debug, Default)]
pub struct InMemoryStorage {
    records: HashMap<EntityKey<'static>, Record>,
    search_documents: HashMap<(SearchProfile, EntityKey<'static>), SearchDocument>,
    projections: HashMap<PredicateRecordKey, ProjectionState>,
    optimistic_projections: HashMap<PredicateRecordKey, EffectiveOptimisticProjection>,
    mutations: BTreeMap<
        MutationId,
        (
            crate::queue::StoredMutation,
            crate::queue::PersistedOptimisticLayer,
        ),
    >,
    next_mutation_id: MutationId,
    record_get_count: Arc<AtomicUsize>,
    search_catalog_load_count: Arc<AtomicUsize>,
    mutation_queue_load_count: Arc<AtomicUsize>,
}

impl InMemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Number of normalized-record get calls (test diagnostics).
    pub fn record_get_count(&self) -> usize {
        self.record_get_count.load(Ordering::Relaxed)
    }

    /// Number of compact catalog loads (test diagnostics).
    pub fn search_catalog_load_count(&self) -> usize {
        self.search_catalog_load_count.load(Ordering::Relaxed)
    }

    /// Number of full mutation-queue loads (test diagnostics).
    pub fn mutation_queue_load_count(&self) -> usize {
        self.mutation_queue_load_count.load(Ordering::Relaxed)
    }
}

impl Storage for InMemoryStorage {
    type Error = Infallible;

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        self.record_get_count.fetch_add(1, Ordering::Relaxed);
        Ok(keys.iter().map(|k| self.records.get(k).cloned()).collect())
    }

    async fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<(), Self::Error> {
        for (key, record) in entries {
            self.search_documents
                .retain(|(_, existing_key), _| existing_key != &key);
            for document in project_search_documents(&key, &record) {
                self.search_documents
                    .insert((document.profile, key.clone()), document);
            }
            self.records.insert(key, record);
        }
        Ok(())
    }

    async fn put_batch_with_projections(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.put_batch(entries).await?;
        apply_in_memory_projection_mutations(&mut self.projections, projections);
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey<'static>]) -> Result<(), Self::Error> {
        for key in keys {
            self.records.remove(key);
            self.search_documents
                .retain(|(_, existing_key), _| existing_key != key);
        }
        Ok(())
    }

    async fn load_search_documents(
        &self,
        profile: SearchProfile,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        self.search_catalog_load_count
            .fetch_add(1, Ordering::Relaxed);
        Ok(self
            .search_documents
            .iter()
            .filter(|((candidate, _), _)| *candidate == profile)
            .map(|(_, document)| document.clone())
            .collect())
    }

    async fn browse_search_documents(
        &self,
        profile: SearchProfile,
        bucket: &str,
        after: Option<&SearchCursor>,
        limit: usize,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        let mut documents: Vec<_> = self
            .search_documents
            .values()
            .filter(|document| document.profile == profile && document.bucket == bucket)
            .filter(|document| {
                after.is_none_or(|cursor| {
                    document.timestamp_ms < cursor.timestamp_ms
                        || (document.timestamp_ms == cursor.timestamp_ms
                            && crate::search::compare_record_keys(
                                &document.record_key,
                                &cursor.record_key,
                            )
                            .is_gt())
                })
            })
            .cloned()
            .collect();
        documents.sort_by(crate::search::compare_recent);
        documents.truncate(limit);
        Ok(documents)
    }

    async fn enqueue_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        projections: Vec<PendingOptimisticProjection>,
    ) -> Result<MutationId, Self::Error> {
        self.next_mutation_id += 1;
        let id = self.next_mutation_id;
        self.mutations
            .insert(id, (entry.mutation, entry.optimistic));
        for projection in projections {
            let record_key = projection.state.record_key().clone();
            self.optimistic_projections.insert(
                record_key,
                EffectiveOptimisticProjection {
                    owner: id,
                    state: projection.state,
                    uncertainty: projection.uncertainty,
                },
            );
        }
        Ok(id)
    }

    async fn load_projection_states(
        &self,
        keys: &[PredicateRecordKey],
    ) -> Result<Vec<Option<ProjectionState>>, Self::Error> {
        Ok(keys
            .iter()
            .map(|key| self.projections.get(key).cloned())
            .collect())
    }

    async fn load_optimistic_projections(
        &self,
        keys: &[PredicateRecordKey],
    ) -> Result<Vec<Option<EffectiveOptimisticProjection>>, Self::Error> {
        Ok(keys
            .iter()
            .map(|key| self.optimistic_projections.get(key).cloned())
            .collect())
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        self.mutation_queue_load_count
            .fetch_add(1, Ordering::Relaxed);
        Ok(self
            .mutations
            .iter()
            .map(|(id, (mutation, optimistic))| QueuedMutation {
                id: *id,
                mutation: mutation.clone(),
                optimistic: optimistic.clone(),
            })
            .collect())
    }

    async fn queue_diagnostics(&self) -> Result<QueueDiagnostics, Self::Error> {
        Ok(QueueDiagnostics {
            availability: QueueDiagnosticsAvailability::Available,
            depth: self.mutations.len() as u64,
            oldest_created_at_ms: self
                .mutations
                .values()
                .map(|(mutation, _)| mutation.created_at_ms)
                .min(),
        })
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        let Some((&id, (mutation, optimistic))) = self.mutations.iter_mut().next() else {
            return Ok(None);
        };
        if mutation
            .next_attempt_at_ms
            .is_some_and(|next| next > request.now_ms)
            || mutation
                .lease_expires_at_ms
                .is_some_and(|expiry| expiry > request.now_ms)
        {
            return Ok(None);
        }

        mutation.attempt_count = mutation.attempt_count.saturating_add(1);
        mutation.lease_generation = mutation.lease_generation.saturating_add(1);
        mutation.lease_owner = Some(request.owner);
        mutation.lease_expires_at_ms = Some(request.lease_expires_at_ms);
        mutation.next_attempt_at_ms = None;
        let generation = mutation.lease_generation;
        Ok(Some(ClaimedMutation {
            queued: QueuedMutation {
                id,
                mutation: mutation.clone(),
                optimistic: optimistic.clone(),
            },
            lease_generation: generation,
        }))
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<bool, Self::Error> {
        let Some((mutation, _)) = self.mutations.get_mut(&id) else {
            return Ok(false);
        };
        if !claim_matches(mutation, &claim) {
            return Ok(false);
        }
        mutation.next_attempt_at_ms = Some(next_attempt_at_ms);
        mutation.last_error = Some(error);
        mutation.lease_owner = None;
        mutation.lease_expires_at_ms = None;
        Ok(true)
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<bool, Self::Error> {
        self.complete_mutation_with_projections(id, claim, entries, Vec::new())
            .await
    }

    async fn complete_mutation_with_projections(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<bool, Self::Error> {
        let Some((mutation, _)) = self.mutations.get(&id) else {
            return Ok(false);
        };
        if !claim_matches(mutation, &claim) {
            return Ok(false);
        }
        for (key, record) in entries {
            self.search_documents
                .retain(|(_, existing_key), _| existing_key != &key);
            for document in project_search_documents(&key, &record) {
                self.search_documents
                    .insert((document.profile, key.clone()), document);
            }
            self.records.insert(key, record);
        }
        apply_in_memory_projection_mutations(&mut self.projections, projections);
        self.mutations.remove(&id);
        self.optimistic_projections
            .retain(|_, projection| projection.owner != id);
        Ok(true)
    }

    async fn complete_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
        reconciliation: OptimisticShadowReconciliation,
    ) -> Result<bool, Self::Error> {
        if reconciliation.validate(id).is_err()
            || self.mutations.keys().copied().collect::<Vec<_>>() != reconciliation.expected_queue
        {
            return Ok(false);
        }
        let Some((mutation, _)) = self.mutations.get(&id) else {
            return Ok(false);
        };
        if !claim_matches(mutation, &claim) {
            return Ok(false);
        }
        for replacement in &reconciliation.replacements {
            if replacement.owner == id || !self.mutations.contains_key(&replacement.owner) {
                return Ok(false);
            }
        }
        for (key, record) in entries {
            self.search_documents
                .retain(|(_, existing_key), _| existing_key != &key);
            for document in project_search_documents(&key, &record) {
                self.search_documents
                    .insert((document.profile, key.clone()), document);
            }
            self.records.insert(key, record);
        }
        apply_in_memory_projection_mutations(&mut self.projections, projections);
        self.mutations.remove(&id);
        for key in reconciliation.affected_keys {
            self.optimistic_projections.remove(&key);
        }
        for replacement in reconciliation.replacements {
            self.optimistic_projections
                .insert(replacement.state.record_key().clone(), replacement);
        }
        Ok(true)
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        let Some((mutation, _)) = self.mutations.get(&id) else {
            return Ok(false);
        };
        if !claim_matches(mutation, &claim) {
            return Ok(false);
        }
        self.mutations.remove(&id);
        self.optimistic_projections
            .retain(|_, projection| projection.owner != id);
        Ok(true)
    }

    async fn discard_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        reconciliation: OptimisticShadowReconciliation,
    ) -> Result<bool, Self::Error> {
        if reconciliation.validate(id).is_err()
            || self.mutations.keys().copied().collect::<Vec<_>>() != reconciliation.expected_queue
        {
            return Ok(false);
        }
        let Some((mutation, _)) = self.mutations.get(&id) else {
            return Ok(false);
        };
        if !claim_matches(mutation, &claim) {
            return Ok(false);
        }
        for replacement in &reconciliation.replacements {
            if replacement.owner == id || !self.mutations.contains_key(&replacement.owner) {
                return Ok(false);
            }
        }
        self.mutations.remove(&id);
        for key in reconciliation.affected_keys {
            self.optimistic_projections.remove(&key);
        }
        for replacement in reconciliation.replacements {
            self.optimistic_projections
                .insert(replacement.state.record_key().clone(), replacement);
        }
        Ok(true)
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.records.clear();
        self.search_documents.clear();
        self.projections.clear();
        self.optimistic_projections.clear();
        self.mutations.clear();
        Ok(())
    }
}

impl PredicateIndexStorage for InMemoryStorage {
    async fn delete_batch_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projection_keys: &[PredicateRecordKey],
    ) -> Result<(), Self::Error> {
        self.delete_batch(keys).await?;
        for key in projection_keys {
            self.projections.remove(key);
        }
        Ok(())
    }

    async fn query_predicate_index(
        &self,
        query: &predicate_index::ValidatedIndexQuery,
    ) -> Result<PredicateQueryResult, Self::Error> {
        let descriptor = query.as_query();
        let queried_partitions = descriptor
            .partitions
            .iter()
            .map(|partition| &partition.partition)
            .collect::<HashSet<_>>();
        if self.projections.iter().any(|(key, projection)| {
            !self.optimistic_projections.contains_key(key)
                && projection.profile() == &descriptor.profile
                && queried_partitions.contains(projection.partition())
                && matches!(projection, ProjectionState::Incomplete { .. })
        }) {
            return Ok(PredicateQueryResult::Incomplete);
        }

        let mut has_relevant_shadow = false;
        for (key, projection) in &self.optimistic_projections {
            let current_scope = projection.state.profile() == &descriptor.profile
                && queried_partitions.contains(projection.state.partition());
            let shadows_queried_authority = self.projections.get(key).is_some_and(|authority| {
                authority.profile() == &descriptor.profile
                    && queried_partitions.contains(authority.partition())
            });
            if !current_scope && !shadows_queried_authority {
                continue;
            }
            has_relevant_shadow = true;
            if current_scope
                && matches!(
                    projection.state,
                    predicate_index::OptimisticProjectionState::Incomplete { .. }
                )
            {
                return Ok(PredicateQueryResult::Incomplete);
            }
            if current_scope
                && query
                    .dependent_attributes(projection.state.partition())
                    .iter()
                    .any(|attribute| projection.uncertainty.affects(attribute))
            {
                return Ok(PredicateQueryResult::Incomplete);
            }
        }

        let documents = self
            .projections
            .iter()
            .filter(|(key, _)| !self.optimistic_projections.contains_key(*key))
            .filter_map(|(_, projection)| match projection {
                ProjectionState::Complete(document) => Some(document.clone()),
                ProjectionState::Incomplete { .. } => None,
            })
            .chain(
                self.optimistic_projections
                    .values()
                    .filter_map(|projection| match &projection.state {
                        predicate_index::OptimisticProjectionState::Complete(document) => {
                            Some(document.clone())
                        }
                        predicate_index::OptimisticProjectionState::Deleted { .. }
                        | predicate_index::OptimisticProjectionState::Incomplete { .. } => None,
                    }),
            )
            .collect::<Vec<IndexDocument>>();
        let keys = evaluate_reference(query, &documents)
            .into_iter()
            .map(|hit| hit.record_key)
            .collect();
        Ok(if has_relevant_shadow {
            PredicateQueryResult::Optimistic(keys)
        } else {
            PredicateQueryResult::Complete(keys)
        })
    }
}

fn apply_in_memory_projection_mutations(
    projections: &mut HashMap<PredicateRecordKey, ProjectionState>,
    mutations: Vec<ProjectionMutation>,
) {
    for mutation in mutations {
        match mutation {
            ProjectionMutation::Replace(document) => {
                projections.insert(
                    document.record_key.clone(),
                    ProjectionState::Complete(document),
                );
            }
            ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                kind,
            } => {
                projections.insert(
                    record_key.clone(),
                    ProjectionState::Incomplete {
                        record_key,
                        profile,
                        partition,
                        kind,
                    },
                );
            }
            ProjectionMutation::Delete(record_key) => {
                projections.remove(&record_key);
            }
        }
    }
}

fn claim_matches(mutation: &crate::queue::StoredMutation, claim: &MutationClaimToken) -> bool {
    mutation.lease_owner.as_deref() == Some(&claim.owner)
        && mutation.lease_generation == claim.generation
}
