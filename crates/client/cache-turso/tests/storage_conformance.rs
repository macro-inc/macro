#![cfg(not(target_arch = "wasm32"))]

use cache_core::normalize::RecordUpdates;
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoMemoryDatabase, TursoStorage};
use pollster::block_on;

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

fn queued(label: &str, created_at_ms: i64) -> NewQueuedMutation {
    let mut update = Record::default();
    update
        .fields
        .insert("value".into(), CacheValue::String(label.into()));
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v4(),
        mutation: StoredMutation {
            request: MutationRequest {
                query: format!("mutation {label} {{ update {{ id }} }}"),
                operation_name: Some(label.into()),
                variables_json: format!(r#"{{"label":"{label}"}}"#),
                identity: Some("identity-witness".into()),
            },
            attempt_count: 7,
            next_attempt_at_ms: None,
            lease_owner: None,
            lease_generation: 11,
            lease_expires_at_ms: None,
            last_error: Some("previous retry".into()),
            created_at_ms,
        },
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: format!(r#"{{"update":{{"label":"{label}"}}}}"#),
            normalized_updates: RecordUpdates::from([(key("Thing:1"), update)]),
        },
    }
}

fn queued_with_uuid(label: &str, created_at_ms: i64, uuid: uuid::Uuid) -> NewQueuedMutation {
    let mut queued = queued(label, created_at_ms);
    queued.uuid = uuid;
    queued
}

fn claim(owner: &str, generation: u64) -> MutationClaimToken {
    MutationClaimToken {
        owner: owner.into(),
        generation,
    }
}

#[test]
fn uuid_replacements_survive_reopen_with_pending_and_active_semantics() {
    block_on(async {
        let database = TursoMemoryDatabase::new("uuid-replacements.db");
        let uuid = uuid::Uuid::new_v4();
        let mut storage = database.open("pending").unwrap();
        let first = storage
            .enqueue_mutation(queued_with_uuid("First", 1, uuid))
            .await
            .unwrap();
        let replacement = storage
            .enqueue_mutation(queued_with_uuid("Replacement", 2, uuid))
            .await
            .unwrap();
        assert!(replacement > first);
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 1);
        storage.try_close().unwrap();

        let storage = database.open("pending").unwrap();
        let queue = storage.load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].id, replacement);
        assert_eq!(queue[0].uuid, uuid);
        storage.try_close().unwrap();

        database.physical_reset();
        let mut storage = database.open("active").unwrap();
        let active = storage
            .enqueue_mutation(queued_with_uuid("Active", 10, uuid))
            .await
            .unwrap();
        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 10,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, active);
        let replacement = storage
            .enqueue_mutation(queued_with_uuid("Latest", 11, uuid))
            .await
            .unwrap();
        storage.try_close().unwrap();

        let storage = database.open("active").unwrap();
        let queue = storage.load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0].id, active);
        assert!(queue[0].superseded);
        assert_eq!(queue[1].id, replacement);
        assert!(!queue[1].superseded);
    });
}

#[test]
fn compound_keys_batches_duplicates_and_checked_inputs_conform() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("scope-batches").unwrap();
        let valid = [
            "ROOT_QUERY",
            "GraphqlSoupDocument:doc-1",
            "GraphqlSoupDocument:tenant:doc-1",
            "__meta:identity",
            "Thing:",
        ];
        storage
            .put_batch(
                valid
                    .iter()
                    .enumerate()
                    .map(|(index, value)| (key(value), record(&index.to_string())))
                    .collect(),
            )
            .await
            .unwrap();

        let requested = [
            key("Missing:leading"),
            key(valid[1]),
            key("Missing:middle"),
            key(valid[1]),
            key(valid[4]),
            key("Missing:trailing"),
        ];
        let values = storage.get_batch(&requested).await.unwrap();
        assert_eq!(values.len(), requested.len());
        assert!(values[0].is_none());
        assert_eq!(values[1], Some(record("1")));
        assert!(values[2].is_none());
        assert_eq!(values[3], values[1]);
        assert_eq!(values[4], Some(record("4")));
        assert!(values[5].is_none());

        storage
            .put_batch(vec![
                (key("Duplicate:1"), record("first")),
                (key("Duplicate:1"), record("last")),
            ])
            .await
            .unwrap();
        assert_eq!(
            storage.get_batch(&[key("Duplicate:1")]).await.unwrap(),
            vec![Some(record("last"))]
        );
        storage
            .delete_batch(&[
                key("Missing:delete"),
                key("Duplicate:1"),
                key("Duplicate:1"),
            ])
            .await
            .unwrap();
        assert_eq!(
            storage.get_batch(&[key("Duplicate:1")]).await.unwrap(),
            vec![None]
        );

        for invalid in ["", "Colonless", ":id", "ROOT_QUERY:"] {
            let error = storage
                .put_batch(vec![(key(invalid), record("invalid"))])
                .await
                .unwrap_err();
            assert!(!error.requires_physical_reset());
        }
        storage.try_close().unwrap();
    });
}

#[test]
fn queue_preserves_every_field_order_and_reopen_state() {
    block_on(async {
        let database = TursoMemoryDatabase::new("queue-reopen.db");
        let mut storage = database.open("scope-queue-reopen").unwrap();
        let mut first_entry = queued("First", 100);
        first_entry.mutation.next_attempt_at_ms = Some(150);
        first_entry.mutation.lease_owner = Some("reopen-owner".into());
        first_entry.mutation.lease_expires_at_ms = Some(175);
        let second_entry = NewQueuedMutation {
            uuid: uuid::Uuid::new_v4(),
            mutation: StoredMutation::new(
                MutationRequest {
                    query: "mutation Second { update { id } }".into(),
                    operation_name: None,
                    variables_json: "{}".into(),
                    identity: None,
                },
                -20,
            ),
            optimistic: PersistedOptimisticLayer {
                optimistic_data_json: "null".into(),
                normalized_updates: RecordUpdates::default(),
            },
        };
        let first = storage.enqueue_mutation(first_entry.clone()).await.unwrap();
        let second = storage
            .enqueue_mutation(second_entry.clone())
            .await
            .unwrap();
        assert!(first > 0 && second > first);
        storage.try_close().unwrap();

        let storage = database.open("scope-queue-reopen").unwrap();
        let loaded = storage.load_mutation_queue().await.unwrap();
        assert_eq!(
            loaded.iter().map(|entry| entry.id).collect::<Vec<_>>(),
            vec![first, second]
        );
        assert_eq!(loaded[0].mutation, first_entry.mutation);
        assert_eq!(loaded[0].optimistic, first_entry.optimistic);
        assert_eq!(loaded[1].mutation, second_entry.mutation);
        assert_eq!(loaded[1].optimistic, second_entry.optimistic);
        storage.try_close().unwrap();
    });
}

#[test]
fn strict_head_retries_leases_and_fences_conform() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("scope-leases").unwrap();
        let mut first_entry = queued("First", 1);
        first_entry.mutation.attempt_count = 0;
        first_entry.mutation.lease_generation = 0;
        first_entry.mutation.last_error = None;
        first_entry.mutation.next_attempt_at_ms = Some(100);
        let mut second_entry = queued("Second", 2);
        second_entry.mutation.attempt_count = 0;
        second_entry.mutation.lease_generation = 0;
        second_entry.mutation.last_error = None;
        let first = storage.enqueue_mutation(first_entry).await.unwrap();
        let second = storage.enqueue_mutation(second_entry).await.unwrap();

        assert!(
            storage
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner-a".into(),
                    now_ms: 99,
                    lease_expires_at_ms: 150,
                })
                .await
                .unwrap()
                .is_none()
        );
        let first_claim = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-a".into(),
                now_ms: 100,
                lease_expires_at_ms: 150,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first_claim.queued.id, first);
        assert_eq!(first_claim.queued.mutation.attempt_count, 1);
        assert_eq!(first_claim.lease_generation, 1);
        assert!(
            storage
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner-b".into(),
                    now_ms: 149,
                    lease_expires_at_ms: 200,
                })
                .await
                .unwrap()
                .is_none()
        );

        let reclaimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-b".into(),
                now_ms: 150,
                lease_expires_at_ms: 250,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reclaimed.queued.id, first);
        assert_eq!(reclaimed.queued.mutation.attempt_count, 2);
        assert_eq!(reclaimed.lease_generation, 2);
        assert!(
            !storage
                .defer_mutation(first, claim("runner-a", 1), 300, "stale".into())
                .await
                .unwrap()
        );
        assert!(
            storage
                .defer_mutation(first, claim("runner-b", 2), 300, "offline".into())
                .await
                .unwrap()
        );
        let deferred = storage.load_mutation_queue().await.unwrap();
        assert_eq!(deferred[0].mutation.next_attempt_at_ms, Some(300));
        assert_eq!(deferred[0].mutation.lease_owner, None);
        assert_eq!(deferred[0].mutation.lease_expires_at_ms, None);
        assert_eq!(deferred[0].mutation.lease_generation, 2);
        assert_eq!(deferred[0].mutation.last_error.as_deref(), Some("offline"));
        assert!(
            storage
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner-c".into(),
                    now_ms: 299,
                    lease_expires_at_ms: 400,
                })
                .await
                .unwrap()
                .is_none()
        );
        let third_claim = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-c".into(),
                now_ms: 300,
                lease_expires_at_ms: 400,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(third_claim.lease_generation, 3);
        assert!(
            !storage
                .discard_mutation(first, claim("runner-b", 2))
                .await
                .unwrap()
        );
        assert!(
            storage
                .discard_mutation(first, claim("runner-c", 3))
                .await
                .unwrap()
        );
        let next = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-d".into(),
                now_ms: 300,
                lease_expires_at_ms: 500,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(next.queued.id, second);
        storage.try_close().unwrap();
    });
}

#[test]
fn complete_discard_clear_and_non_reused_ids_are_atomic_semantics() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("scope-settlement").unwrap();
        let first = storage
            .enqueue_mutation(queued("Complete", 1))
            .await
            .unwrap();
        let first_claim = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert!(
            !storage
                .complete_mutation(
                    first,
                    claim("stale", first_claim.lease_generation),
                    vec![(key("Result:stale"), record("must-not-write"))],
                )
                .await
                .unwrap()
        );
        assert_eq!(
            storage.get_batch(&[key("Result:stale")]).await.unwrap(),
            vec![None]
        );
        assert!(
            storage
                .complete_mutation(
                    first,
                    claim("runner", first_claim.lease_generation),
                    vec![
                        (key("Result:1"), record("first")),
                        (key("Result:1"), record("last")),
                    ],
                )
                .await
                .unwrap()
        );
        assert_eq!(
            storage.get_batch(&[key("Result:1")]).await.unwrap(),
            vec![Some(record("last"))]
        );
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());

        let discarded = storage
            .enqueue_mutation(queued("Discard", 2))
            .await
            .unwrap();
        let discard_claim = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "discarder".into(),
                now_ms: 2,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert!(
            storage
                .discard_mutation(
                    discarded,
                    claim("discarder", discard_claim.lease_generation),
                )
                .await
                .unwrap()
        );
        assert_eq!(
            storage.get_batch(&[key("Result:1")]).await.unwrap(),
            vec![Some(record("last"))]
        );

        let before_clear = storage
            .enqueue_mutation(queued("BeforeClear", 3))
            .await
            .unwrap();
        storage.clear().await.unwrap();
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());
        assert_eq!(
            storage.get_batch(&[key("Result:1")]).await.unwrap(),
            vec![None]
        );
        let after_clear = storage
            .enqueue_mutation(queued("AfterClear", 4))
            .await
            .unwrap();
        assert!(after_clear > before_clear);
        storage.try_close().unwrap();
    });
}

#[test]
fn checked_rust_queue_values_are_rejected_before_transactions() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("scope-numerics").unwrap();
        let mut oversized = queued("Oversized", 1);
        oversized.mutation.lease_generation = u64::MAX;
        assert!(
            !storage
                .enqueue_mutation(oversized)
                .await
                .unwrap_err()
                .requires_physical_reset()
        );
        assert!(
            !storage
                .discard_mutation(
                    u64::MAX,
                    MutationClaimToken {
                        owner: "runner".into(),
                        generation: 0,
                    },
                )
                .await
                .unwrap_err()
                .requires_physical_reset()
        );
        storage.try_close().unwrap();
    });
}
