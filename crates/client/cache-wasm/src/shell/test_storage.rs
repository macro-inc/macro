use cache_core::predicate::{
    OptimisticShadowReconciliation, PredicateIndexStorage, PredicateQueryResult,
    ProjectionMutation, ProjectionState,
};
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, NewQueuedMutation,
    QueuedMutation,
};
use cache_core::search::{SearchCursor, SearchDocument, SearchProfile};
use cache_core::store::{QueueDiagnostics, Storage};
use cache_core::value::{EntityKey, Record};
use cache_turso::{PhysicalResetReason, TursoStorage, TursoStorageError};
use predicate_index::{
    EffectiveOptimisticProjection, PendingOptimisticProjection, RecordKey, ValidatedIndexQuery,
};
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy)]
pub(super) enum TestStorageFault {
    GetBatch = 1,
    ClaimNextMutation = 2,
}

pub(super) struct BrowserStorage {
    inner: TursoStorage,
    fault: AtomicU8,
}

impl BrowserStorage {
    pub(super) fn new(inner: TursoStorage) -> Self {
        Self {
            inner,
            fault: AtomicU8::new(0),
        }
    }

    pub(super) fn into_inner(self) -> TursoStorage {
        self.inner
    }

    pub(super) fn arm(&self, fault: TestStorageFault) {
        self.fault.store(fault as u8, Ordering::Release);
    }

    fn take(&self, fault: TestStorageFault) -> Result<(), TursoStorageError> {
        if self
            .fault
            .compare_exchange(fault as u8, 0, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            Err(TursoStorageError::PhysicalResetRequired(
                PhysicalResetReason::Codec,
            ))
        } else {
            Ok(())
        }
    }
}

impl Storage for BrowserStorage {
    type Error = TursoStorageError;

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        self.take(TestStorageFault::GetBatch)?;
        self.inner.get_batch(keys).await
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

    async fn load_search_documents(
        &self,
        profile: SearchProfile,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        self.inner.load_search_documents(profile).await
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

    async fn enqueue_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        projections: Vec<PendingOptimisticProjection>,
    ) -> Result<MutationId, Self::Error> {
        self.inner
            .enqueue_mutation_with_shadow(entry, projections)
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
        self.take(TestStorageFault::ClaimNextMutation)?;
        self.inner.claim_next_mutation(request).await
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<bool, Self::Error> {
        self.inner
            .defer_mutation(id, claim, next_attempt_at_ms, error)
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
}

impl PredicateIndexStorage for BrowserStorage {
    async fn delete_batch_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projection_keys: &[RecordKey],
    ) -> Result<(), Self::Error> {
        self.inner
            .delete_batch_with_projections(keys, projection_keys)
            .await
    }

    async fn query_predicate_index(
        &self,
        query: &ValidatedIndexQuery,
    ) -> Result<PredicateQueryResult, Self::Error> {
        self.inner.query_predicate_index(query).await
    }
}
