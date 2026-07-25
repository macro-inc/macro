//! Storage abstraction: the cold tier behind the in-memory hot tier.
//!
//! Implementations: in-memory (tests, Phase 1), IndexedDB via the `idb`
//! crate (browser, Phase 2), SQLite (Tauri native, Phase 2). Futures are
//! [`MaybeSend`]: `Send` on native targets (so hosts can drive the engine
//! from a multi-threaded runtime), unbounded on wasm — wasm futures aren't
//! `Send`.

use crate::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, NewQueuedMutation,
    QueuedMutation,
};
use crate::value::{EntityKey, Record};
use maybe_send::MaybeSend;
use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;

/// Async KV over normalized records. Batch-oriented by design: the engine
/// issues one `get_batch` per denormalization round, never per record.
pub trait Storage: MaybeSend {
    type Error: std::error::Error + MaybeSend + 'static;

    /// Fetches records; result is aligned with `keys` (`None` = absent).
    fn get_batch(
        &self,
        keys: &[EntityKey],
    ) -> impl Future<Output = Result<Vec<Option<Record>>, Self::Error>> + MaybeSend;

    /// Upserts records atomically (all-or-nothing per batch).
    fn put_batch(
        &mut self,
        entries: Vec<(EntityKey, Record)>,
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Deletes records (absent keys are ignored).
    fn delete_batch(
        &mut self,
        keys: &[EntityKey],
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Scans normalized records of the requested concrete types in ascending
    /// entity-key order. `after` is exclusive.
    fn scan_records(
        &self,
        type_names: &[String],
        after: Option<&EntityKey>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<(EntityKey, Record)>, Self::Error>> + MaybeSend;

    /// Atomically appends a mutation and its optimistic layer to the queue.
    fn enqueue_mutation(
        &mut self,
        entry: NewQueuedMutation,
    ) -> impl Future<Output = Result<MutationId, Self::Error>> + MaybeSend;

    /// Loads the complete mutation queue in ascending id order.
    fn load_mutation_queue(
        &self,
    ) -> impl Future<Output = Result<Vec<QueuedMutation>, Self::Error>> + MaybeSend;

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
        entries: Vec<(EntityKey, Record)>,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend;

    /// Atomically removes a permanently failed mutation and its optimistic
    /// layer. Returns `false` when the claim is stale.
    fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> impl Future<Output = Result<bool, Self::Error>> + MaybeSend;

    /// Drops records, queued mutations, and optimistic layers (logout or
    /// identity mismatch).
    fn clear(&mut self) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;
}

/// Hash-map storage for tests and as the Phase 1 default.
#[derive(Clone, Debug, Default)]
pub struct InMemoryStorage {
    records: HashMap<EntityKey, Record>,
    mutations: BTreeMap<
        MutationId,
        (
            crate::queue::StoredMutation,
            crate::queue::PersistedOptimisticLayer,
        ),
    >,
    next_mutation_id: MutationId,
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
}

impl Storage for InMemoryStorage {
    type Error = Infallible;

    async fn get_batch(&self, keys: &[EntityKey]) -> Result<Vec<Option<Record>>, Self::Error> {
        Ok(keys.iter().map(|k| self.records.get(k).cloned()).collect())
    }

    async fn put_batch(&mut self, entries: Vec<(EntityKey, Record)>) -> Result<(), Self::Error> {
        for (k, v) in entries {
            self.records.insert(k, v);
        }
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey]) -> Result<(), Self::Error> {
        for k in keys {
            self.records.remove(k);
        }
        Ok(())
    }

    async fn scan_records(
        &self,
        type_names: &[String],
        after: Option<&EntityKey>,
        limit: usize,
    ) -> Result<Vec<(EntityKey, Record)>, Self::Error> {
        if limit == 0 || type_names.is_empty() {
            return Ok(Vec::new());
        }
        let type_names: std::collections::HashSet<_> =
            type_names.iter().map(String::as_str).collect();
        let mut records: Vec<_> = self
            .records
            .iter()
            .filter(|(key, _)| after.is_none_or(|after| *key > after))
            .filter(|(key, _)| {
                key.0
                    .split_once(':')
                    .is_some_and(|(type_name, _)| type_names.contains(type_name))
            })
            .map(|(key, record)| (key.clone(), record.clone()))
            .collect();
        records.sort_by(|(left, _), (right, _)| left.cmp(right));
        records.truncate(limit);
        Ok(records)
    }

    async fn enqueue_mutation(
        &mut self,
        entry: NewQueuedMutation,
    ) -> Result<MutationId, Self::Error> {
        self.next_mutation_id += 1;
        let id = self.next_mutation_id;
        self.mutations
            .insert(id, (entry.mutation, entry.optimistic));
        Ok(id)
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
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
        entries: Vec<(EntityKey, Record)>,
    ) -> Result<bool, Self::Error> {
        let Some((mutation, _)) = self.mutations.get(&id) else {
            return Ok(false);
        };
        if !claim_matches(mutation, &claim) {
            return Ok(false);
        }
        for (key, record) in entries {
            self.records.insert(key, record);
        }
        self.mutations.remove(&id);
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
        Ok(true)
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.records.clear();
        self.mutations.clear();
        Ok(())
    }
}

fn claim_matches(mutation: &crate::queue::StoredMutation, claim: &MutationClaimToken) -> bool {
    mutation.lease_owner.as_deref() == Some(&claim.owner)
        && mutation.lease_generation == claim.generation
}
