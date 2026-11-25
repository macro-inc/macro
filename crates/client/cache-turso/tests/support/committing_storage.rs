//! A [`TursoStorage`] that runs a hook right after its next `get_batch`, to
//! land another connection's commit between two of an engine's storage reads.
use cache_core::predicate::OptimisticShadowReconciliation;
use cache_core::predicate::{
    OptimisticUpsertReconciliation, PredicateIndexStorage, PredicateQueryResult,
    ProjectionMutation, ProjectionState,
};
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, MutationUpsertResult,
    NewQueuedMutation, QueuedMutation,
};
use cache_core::search::{
    SearchCursor, SearchDocument, SearchDocumentRef, SearchProfile, SearchQuery,
};
use cache_core::store::{QueueDiagnostics, Storage};
use cache_core::value::{EntityKey, Record};
use cache_turso::{TursoStorage, TursoStorageError};
use predicate_index::{EffectiveOptimisticProjection, RecordKey, ValidatedIndexQuery};
use std::sync::Mutex;

type Hook = Box<dyn FnOnce() + Send>;

pub struct CommittingStorage {
    inner: TursoStorage,
    after_get_batch: Mutex<Option<Hook>>,
}

impl CommittingStorage {
    pub fn new(inner: TursoStorage) -> Self {
        Self {
            inner,
            after_get_batch: Mutex::new(None),
        }
    }

    /// Runs `hook` once, right after the next `get_batch` has read.
    pub fn after_next_get_batch(&self, hook: impl FnOnce() + Send + 'static) {
        *self.after_get_batch.lock().unwrap() = Some(Box::new(hook));
    }
}

impl Storage for CommittingStorage {
    type Error = TursoStorageError;

    fn write_position(&self) -> Option<cache_core::store::WritePosition> {
        self.inner.write_position()
    }

    async fn record_keys(
        &self,
        typename: &str,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<EntityKey<'static>>, Self::Error> {
        self.inner.record_keys(typename, after_id, limit).await
    }

    async fn projection_keys(
        &self,
        typename: &str,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<EntityKey<'static>>, Self::Error> {
        self.inner.projection_keys(typename, after_id, limit).await
    }

    async fn scan_contact_records(
        &self,
        after: Option<&str>,
        limit: usize,
        visit: impl FnMut(&EntityKey<'_>, &Record) + Send,
    ) -> Result<Option<String>, Self::Error> {
        self.inner.scan_contact_records(after, limit, visit).await
    }

    async fn read_people_sql(
        &self,
        viewer: &str,
        plan: &cache_core::people::sql::PeopleSqlPlan,
    ) -> Result<cache_core::people::sql::PeopleSqlResult, Self::Error> {
        self.inner.read_people_sql(viewer, plan).await
    }

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        let records = self.inner.get_batch(keys).await?;
        let hook = self.after_get_batch.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        Ok(records)
    }

    async fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<(), Self::Error> {
        self.inner.put_batch(entries).await
    }

    async fn put_batch_with_projections(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.inner
            .put_batch_with_projections(entries, projections)
            .await
    }

    async fn delete_batch(&mut self, keys: &[EntityKey<'static>]) -> Result<(), Self::Error> {
        self.inner.delete_batch(keys).await
    }

    async fn visit_search_documents(
        &self,
        profile: SearchProfile,
        bucket: &str,
        query: &SearchQuery,
        visit: impl FnMut(SearchDocumentRef<'_>) + Send,
    ) -> Result<(), Self::Error> {
        self.inner
            .visit_search_documents(profile, bucket, query, visit)
            .await
    }

    async fn visit_name_search(
        &self,
        read: &mut cache_core::people::name_search::reader::NameSearchRead<'_>,
    ) -> Result<(), Self::Error> {
        self.inner.visit_name_search(read).await
    }

    async fn visit_contact_records(
        &self,
        query: &SearchQuery,
        visit: impl FnMut(&EntityKey<'_>, &Record) + Send,
    ) -> Result<(), Self::Error> {
        self.inner.visit_contact_records(query, visit).await
    }

    async fn browse_search_documents(
        &self,
        profile: SearchProfile,
        bucket: &str,
        after: Option<&SearchCursor>,
        limit: usize,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        self.inner
            .browse_search_documents(profile, bucket, after, limit)
            .await
    }

    async fn upsert_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        now_ms: i64,
        reconciliation: OptimisticUpsertReconciliation,
    ) -> Result<MutationUpsertResult, Self::Error> {
        self.inner
            .upsert_mutation_with_shadow(entry, now_ms, reconciliation)
            .await
    }

    async fn load_projection_states(
        &self,
        keys: &[RecordKey],
    ) -> Result<Vec<Option<ProjectionState>>, Self::Error> {
        self.inner.load_projection_states(keys).await
    }

    async fn load_optimistic_projections(
        &self,
        keys: &[RecordKey],
    ) -> Result<Vec<Option<EffectiveOptimisticProjection>>, Self::Error> {
        self.inner.load_optimistic_projections(keys).await
    }

    async fn replace_optimistic_layers(
        &mut self,
        layers: &[(
            cache_core::queue::MutationId,
            cache_core::queue::PersistedOptimisticLayer,
        )],
        affected_projection_keys: &[predicate_index::RecordKey],
        projections: &[predicate_index::EffectiveOptimisticProjection],
    ) -> Result<(), Self::Error> {
        self.inner
            .replace_optimistic_layers(layers, affected_projection_keys, projections)
            .await
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        self.inner.load_mutation_queue().await
    }

    async fn queue_diagnostics(&self) -> Result<QueueDiagnostics, Self::Error> {
        self.inner.queue_diagnostics().await
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        self.inner.claim_next_mutation(request).await
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
        server_failure: bool,
    ) -> Result<bool, Self::Error> {
        self.inner
            .defer_mutation(id, claim, next_attempt_at_ms, error, server_failure)
            .await
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<bool, Self::Error> {
        self.inner.complete_mutation(id, claim, entries).await
    }

    async fn complete_mutation_with_projections(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<bool, Self::Error> {
        self.inner
            .complete_mutation_with_projections(id, claim, entries, projections)
            .await
    }

    async fn complete_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
        reconciliation: OptimisticShadowReconciliation,
    ) -> Result<bool, Self::Error> {
        self.inner
            .complete_mutation_with_shadow(id, claim, entries, projections, reconciliation)
            .await
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        self.inner.discard_mutation(id, claim).await
    }

    async fn discard_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        reconciliation: OptimisticShadowReconciliation,
    ) -> Result<bool, Self::Error> {
        self.inner
            .discard_mutation_with_shadow(id, claim, reconciliation)
            .await
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.inner.clear().await
    }

    async fn reset_with_records(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.inner.reset_with_records(entries, projections).await
    }
}

impl PredicateIndexStorage for CommittingStorage {
    async fn reconcile_predicate_index(
        &self,
        query: &ValidatedIndexQuery,
        baseline: &[cache_core::predicate::reconciliation::PredicateBaselineEntry],
    ) -> Result<cache_core::predicate::reconciliation::PredicateReconciliation, Self::Error> {
        self.inner.reconcile_predicate_index(query, baseline).await
    }

    async fn delete_batch_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projection_keys: &[RecordKey],
    ) -> Result<(), Self::Error> {
        self.inner
            .delete_batch_with_projections(keys, projection_keys)
            .await
    }

    async fn delete_batch_with_projection_changes(
        &mut self,
        keys: &[EntityKey<'static>],
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.inner
            .delete_batch_with_projection_changes(keys, projections)
            .await
    }

    async fn query_predicate_index(
        &self,
        query: &ValidatedIndexQuery,
    ) -> Result<PredicateQueryResult, Self::Error> {
        self.inner.query_predicate_index(query).await
    }
}
