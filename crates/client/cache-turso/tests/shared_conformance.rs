#![cfg(not(target_arch = "wasm32"))]

use cache_core::normalize::RecordUpdates;
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::search::{SearchProfile, project_search_documents};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoMemoryDatabase, TursoStorage, TursoStorageCloseOutcome};
use pollster::block_on;

trait BackendFactory: Sized {
    type Backend: Storage;

    fn create() -> (Self, Self::Backend);
    fn reopen(&mut self, storage: Self::Backend) -> Self::Backend;
    fn finish(self, storage: Self::Backend);
}

struct InMemoryFactory;

impl BackendFactory for InMemoryFactory {
    type Backend = InMemoryStorage;

    fn create() -> (Self, Self::Backend) {
        (Self, InMemoryStorage::new())
    }

    fn reopen(&mut self, storage: Self::Backend) -> Self::Backend {
        storage
    }

    fn finish(self, _: Self::Backend) {}
}

struct TursoFactory {
    database: TursoMemoryDatabase,
}

impl BackendFactory for TursoFactory {
    type Backend = TursoStorage;

    fn create() -> (Self, Self::Backend) {
        let database = TursoMemoryDatabase::new("shared-conformance.db");
        let storage = database.open("shared-conformance").unwrap();
        (Self { database }, storage)
    }

    fn reopen(&mut self, storage: Self::Backend) -> Self::Backend {
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
        self.database.open("shared-conformance").unwrap()
    }

    fn finish(self, storage: Self::Backend) {
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    }
}

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn record(value: &str) -> Record {
    let mut record = Record::default();
    record
        .fields
        .insert("value".into(), CacheValue::String(value.into()));
    record
}

fn queued(label: &str) -> NewQueuedMutation {
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v4(),
        mutation: StoredMutation::new(
            MutationRequest {
                query: format!("mutation {label} {{ update {{ id }} }}"),
                operation_name: Some(label.into()),
                variables_json: "{}".into(),
                identity: None,
            },
            1,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: "{}".into(),
            normalized_updates: RecordUpdates::default(),
        },
    }
}

fn fully_populated_queued() -> NewQueuedMutation {
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v4(),
        mutation: StoredMutation {
            request: MutationRequest {
                query: "mutation Full($id: ID!) { update(id: $id) { id } }".into(),
                operation_name: Some("Full".into()),
                variables_json: r#"{"id":"full"}"#.into(),
                identity: Some("identity-witness".into()),
            },
            attempt_count: 7,
            next_attempt_at_ms: Some(-2),
            lease_owner: Some("expired-owner".into()),
            lease_generation: 11,
            lease_expires_at_ms: Some(-1),
            last_error: Some("previous retry".into()),
            created_at_ms: -3,
        },
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: r#"{"update":{"id":"full"}}"#.into(),
            normalized_updates: RecordUpdates::from([(
                key("Optimistic:full"),
                record("optimistic-full"),
            )]),
        },
    }
}

fn token(owner: &str, generation: u64) -> MutationClaimToken {
    MutationClaimToken {
        owner: owner.into(),
        generation,
    }
}

fn claim_request(owner: &str, now_ms: i64, lease_expires_at_ms: i64) -> MutationClaimRequest {
    MutationClaimRequest {
        owner: owner.into(),
        now_ms,
        lease_expires_at_ms,
    }
}

async fn record_contract<S: Storage>(storage: &mut S) {
    storage
        .put_batch(vec![
            (key("ROOT_QUERY"), record("root")),
            (key("__meta:identity"), record("meta")),
            (key("Thing:"), record("empty-id")),
            (key("Type:9"), record("type-9")),
            (key("Type0:1"), record("type0-1")),
            (key("Other:1"), record("other")),
            (key("Type:0"), record("type-0")),
            (key("Type0:0"), record("type0-first")),
            (key("Type:a"), record("type-a")),
            (key("Type:a:colon"), record("colon-id")),
            (key("Type:a:colon:again"), record("multiple-colon-id")),
            (key("Type0:0"), record("type0-last")),
        ])
        .await
        .unwrap();

    let aligned = storage
        .get_batch(&[
            key("Missing:leading"),
            key("ROOT_QUERY"),
            key("__meta:identity"),
            key("Thing:"),
            key("Type:a:colon:again"),
            key("Missing:middle"),
            key("Type0:0"),
            key("Type0:0"),
            key("Missing:trailing"),
        ])
        .await
        .unwrap();
    assert_eq!(
        aligned,
        vec![
            None,
            Some(record("root")),
            Some(record("meta")),
            Some(record("empty-id")),
            Some(record("multiple-colon-id")),
            None,
            Some(record("type0-last")),
            Some(record("type0-last")),
            None,
        ]
    );

    storage
        .delete_batch(&[key("Missing:delete"), key("Type:a"), key("Type:a")])
        .await
        .unwrap();
    assert_eq!(storage.get_batch(&[key("Type:a")]).await.unwrap(), [None]);
    storage.delete_batch(&[]).await.unwrap();
    storage
        .put_batch(vec![(key("Type:a"), record("restored"))])
        .await
        .unwrap();
}

async fn search_projection_contract<S: Storage>(storage: &mut S) {
    let searchable_key = key("GraphqlSoupDocument:search-1");
    let mut searchable = Record::default();
    searchable.fields.insert(
        "__typename".into(),
        CacheValue::String("GraphqlSoupDocument".into()),
    );
    searchable
        .fields
        .insert("name".into(), CacheValue::String("Quarterly Plan".into()));
    searchable.fields.insert(
        "updatedAt".into(),
        CacheValue::Number(cache_core::value::CacheNumber::PosInt(123)),
    );
    assert_eq!(
        project_search_documents(&searchable_key, &searchable).len(),
        1
    );
    storage
        .put_batch(vec![(searchable_key.clone(), searchable)])
        .await
        .unwrap();
    let loaded = storage
        .load_search_documents(SearchProfile::QuickAccessV1)
        .await
        .unwrap();
    assert!(
        loaded
            .iter()
            .any(|document| document.record_key == searchable_key)
    );
    let browsed = storage
        .browse_search_documents(SearchProfile::QuickAccessV1, "document", None, 1)
        .await
        .unwrap();
    assert_eq!(browsed.len(), 1);
    assert_eq!(browsed[0].record_key, searchable_key);

    storage
        .delete_batch(std::slice::from_ref(&searchable_key))
        .await
        .unwrap();
    assert!(
        storage
            .load_search_documents(SearchProfile::QuickAccessV1)
            .await
            .unwrap()
            .iter()
            .all(|document| document.record_key != searchable_key)
    );
}

async fn reopen_contract<F: BackendFactory>(
    factory: &mut F,
    mut storage: F::Backend,
) -> F::Backend {
    let first_entry = fully_populated_queued();
    let second_entry = queued("ReopenSecond");
    let first = storage.enqueue_mutation(first_entry.clone()).await.unwrap();
    let second = storage
        .enqueue_mutation(second_entry.clone())
        .await
        .unwrap();
    assert!(second > first);

    let mut storage = factory.reopen(storage);
    assert_eq!(
        storage
            .get_batch(&[key("ROOT_QUERY"), key("Type:9"), key("Type:a:colon:again"),])
            .await
            .unwrap(),
        [
            Some(record("root")),
            Some(record("type-9")),
            Some(record("multiple-colon-id")),
        ]
    );
    let loaded = storage.load_mutation_queue().await.unwrap();
    assert_eq!(
        loaded.iter().map(|entry| entry.id).collect::<Vec<_>>(),
        [first, second]
    );
    assert_eq!(loaded[0].mutation, first_entry.mutation);
    assert_eq!(loaded[0].optimistic, first_entry.optimistic);
    assert_eq!(loaded[1].mutation, second_entry.mutation);
    assert_eq!(loaded[1].optimistic, second_entry.optimistic);

    let first_claim = storage
        .claim_next_mutation(claim_request("reopen-first", 0, 1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first_claim.queued.mutation.attempt_count, 8);
    assert_eq!(first_claim.lease_generation, 12);
    assert!(
        storage
            .discard_mutation(first, token("reopen-first", 12))
            .await
            .unwrap()
    );
    let second_claim = storage
        .claim_next_mutation(claim_request("reopen-second", 0, 1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second_claim.queued.id, second);
    assert!(
        storage
            .discard_mutation(
                second,
                token("reopen-second", second_claim.lease_generation),
            )
            .await
            .unwrap()
    );
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage.get_batch(&[key("Type:9")]).await.unwrap(),
        [Some(record("type-9"))],
        "discard must not change existing records"
    );
    storage
}

async fn queue_contract<S: Storage>(storage: &mut S) {
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage.queue_diagnostics().await.unwrap(),
        cache_core::store::QueueDiagnostics {
            availability: cache_core::store::QueueDiagnosticsAvailability::Available,
            depth: 0,
            oldest_created_at_ms: None,
        }
    );
    assert!(
        storage
            .claim_next_mutation(claim_request("empty", 0, 1))
            .await
            .unwrap()
            .is_none()
    );

    let absent = token("absent", 1);
    assert!(
        !storage
            .defer_mutation(999, absent.clone(), 2, "absent".into())
            .await
            .unwrap()
    );
    assert!(
        !storage
            .complete_mutation(999, absent.clone(), Vec::new())
            .await
            .unwrap()
    );
    assert!(!storage.discard_mutation(999, absent).await.unwrap());

    let first = storage.enqueue_mutation(queued("First")).await.unwrap();
    let second = storage.enqueue_mutation(queued("Second")).await.unwrap();
    assert!(second > first);
    assert_eq!(
        storage.queue_diagnostics().await.unwrap(),
        cache_core::store::QueueDiagnostics {
            availability: cache_core::store::QueueDiagnosticsAvailability::Available,
            depth: 2,
            oldest_created_at_ms: Some(1),
        }
    );
    let first_claim = storage
        .claim_next_mutation(claim_request("runner-a", 1, 10))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first_claim.queued.id, first);
    assert_eq!(first_claim.queued.mutation.attempt_count, 1);
    assert_eq!(first_claim.lease_generation, 1);
    assert!(
        storage
            .claim_next_mutation(claim_request("runner-b", 9, 20))
            .await
            .unwrap()
            .is_none(),
        "a leased strict head must block the second row"
    );
    let expired_reclaim = storage
        .claim_next_mutation(claim_request("runner-b", 10, 15))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(expired_reclaim.queued.id, first);
    assert_eq!(expired_reclaim.queued.mutation.attempt_count, 2);
    assert_eq!(expired_reclaim.lease_generation, 2);
    assert!(
        !storage
            .defer_mutation(
                first,
                token("runner-a", first_claim.lease_generation),
                20,
                "stale".into(),
            )
            .await
            .unwrap()
    );
    assert!(
        !storage
            .discard_mutation(first, token("runner-a", first_claim.lease_generation))
            .await
            .unwrap()
    );
    assert!(
        storage
            .defer_mutation(
                first,
                token("runner-b", expired_reclaim.lease_generation),
                20,
                "retry".into(),
            )
            .await
            .unwrap()
    );
    let deferred = storage.load_mutation_queue().await.unwrap();
    assert_eq!(deferred.len(), 2);
    assert_eq!(deferred[0].id, first);
    assert_eq!(deferred[0].mutation.attempt_count, 2);
    assert_eq!(deferred[0].mutation.next_attempt_at_ms, Some(20));
    assert_eq!(deferred[0].mutation.lease_owner, None);
    assert_eq!(deferred[0].mutation.lease_expires_at_ms, None);
    assert_eq!(deferred[0].mutation.lease_generation, 2);
    assert_eq!(deferred[0].mutation.last_error.as_deref(), Some("retry"));
    assert!(
        storage
            .claim_next_mutation(claim_request("runner-c", 19, 30))
            .await
            .unwrap()
            .is_none(),
        "a deferred strict head must block the second row"
    );

    let retry_claim = storage
        .claim_next_mutation(claim_request("runner-c", 20, 30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retry_claim.queued.id, first);
    assert_eq!(retry_claim.queued.mutation.attempt_count, 3);
    assert_eq!(retry_claim.lease_generation, 3);
    assert!(
        !storage
            .discard_mutation(first, token("runner-b", expired_reclaim.lease_generation))
            .await
            .unwrap()
    );
    assert!(
        storage
            .discard_mutation(first, token("runner-c", retry_claim.lease_generation))
            .await
            .unwrap()
    );

    let second_claim = storage
        .claim_next_mutation(claim_request("runner-d", 20, 25))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second_claim.queued.id, second);
    assert_eq!(second_claim.queued.mutation.attempt_count, 1);
    assert!(
        storage
            .defer_mutation(
                second,
                token("runner-d", second_claim.lease_generation),
                30,
                "second retry".into(),
            )
            .await
            .unwrap()
    );
    assert!(
        storage
            .claim_next_mutation(claim_request("runner-e", 29, 40))
            .await
            .unwrap()
            .is_none()
    );
    let second_retry = storage
        .claim_next_mutation(claim_request("runner-e", 30, 40))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second_retry.queued.id, second);
    assert_eq!(second_retry.queued.mutation.attempt_count, 2);
    assert!(
        !storage
            .complete_mutation(
                second,
                token("runner-d", second_claim.lease_generation),
                vec![(key("Result:stale"), record("must-not-write"))],
            )
            .await
            .unwrap()
    );
    assert_eq!(
        storage.get_batch(&[key("Result:stale")]).await.unwrap(),
        [None]
    );
    assert!(
        storage
            .complete_mutation(
                second,
                token("runner-e", second_retry.lease_generation),
                vec![(key("Result:complete"), record("committed"))],
            )
            .await
            .unwrap()
    );
    assert_eq!(
        storage.get_batch(&[key("Result:complete")]).await.unwrap(),
        [Some(record("committed"))]
    );
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert!(
        storage
            .claim_next_mutation(claim_request("empty-again", 40, 50))
            .await
            .unwrap()
            .is_none()
    );
}

async fn clear_contract<S: Storage>(storage: &mut S) {
    let before_clear = storage.enqueue_mutation(queued("Clear")).await.unwrap();
    storage.clear().await.unwrap();
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage
            .get_batch(&[
                key("ROOT_QUERY"),
                key("__meta:identity"),
                key("Thing:"),
                key("Type0:0"),
                key("Type:9"),
                key("Other:1"),
                key("Result:complete"),
            ])
            .await
            .unwrap(),
        [None, None, None, None, None, None, None]
    );
    assert!(
        storage
            .claim_next_mutation(claim_request("after-clear", 50, 60))
            .await
            .unwrap()
            .is_none()
    );
    let after_clear = storage
        .enqueue_mutation(queued("AfterClear"))
        .await
        .unwrap();
    assert!(after_clear > before_clear);
    storage.clear().await.unwrap();
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
}

async fn common_contract<F: BackendFactory>(
    factory: &mut F,
    mut storage: F::Backend,
) -> F::Backend {
    record_contract(&mut storage).await;
    search_projection_contract(&mut storage).await;
    let mut storage = reopen_contract(factory, storage).await;
    queue_contract(&mut storage).await;
    clear_contract(&mut storage).await;
    storage
}

fn run<F: BackendFactory>() {
    let (mut factory, storage) = F::create();
    let storage = block_on(common_contract(&mut factory, storage));
    factory.finish(storage);
}

#[test]
fn in_memory_storage_satisfies_shared_contract() {
    run::<InMemoryFactory>();
}

#[test]
fn turso_storage_satisfies_shared_contract() {
    run::<TursoFactory>();
}
