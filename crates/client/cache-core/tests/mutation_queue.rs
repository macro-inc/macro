use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;

fn queued(value: &str, created_at_ms: i64) -> NewQueuedMutation {
    let mut update = Record::default();
    update
        .fields
        .insert("name".into(), CacheValue::String(value.into()));
    NewQueuedMutation {
        mutation: StoredMutation::new(
            MutationRequest {
                query: "mutation Rename { rename { id } }".into(),
                operation_name: Some("Rename".into()),
                variables_json: format!(r#"{{"name":"{value}"}}"#),
                identity: Some("user-1".into()),
            },
            created_at_ms,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: format!(r#"{{"rename":{{"name":"{value}"}}}}"#),
            normalized_updates: [(EntityKey("Thing:1".into()), update)].into(),
        },
    }
}

#[test]
fn queue_claim_retry_and_settlement_are_ordered() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let first = storage.enqueue_mutation(queued("a", 1)).await.unwrap();
        let second = storage.enqueue_mutation(queued("b", 2)).await.unwrap();
        assert!(first < second);

        let loaded = storage.load_mutation_queue().await.unwrap();
        assert_eq!(
            loaded.iter().map(|entry| entry.id).collect::<Vec<_>>(),
            [first, second]
        );

        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-1".into(),
                now_ms: 10,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, first);
        assert_eq!(claimed.queued.mutation.attempt_count, 1);

        // The leased head blocks every later mutation.
        assert!(
            storage
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner-2".into(),
                    now_ms: 20,
                    lease_expires_at_ms: 120,
                })
                .await
                .unwrap()
                .is_none()
        );

        assert!(
            storage
                .defer_mutation(
                    first,
                    MutationClaimToken {
                        owner: "runner-1".into(),
                        generation: claimed.lease_generation,
                    },
                    200,
                    "offline".into(),
                )
                .await
                .unwrap()
        );
        assert!(
            storage
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner-2".into(),
                    now_ms: 199,
                    lease_expires_at_ms: 300,
                })
                .await
                .unwrap()
                .is_none()
        );

        let retried = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-2".into(),
                now_ms: 200,
                lease_expires_at_ms: 300,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(retried.queued.id, first);
        assert_eq!(retried.queued.mutation.attempt_count, 2);

        let mut real = Record::default();
        real.fields
            .insert("name".into(), CacheValue::String("server".into()));
        assert!(
            storage
                .complete_mutation(
                    first,
                    MutationClaimToken {
                        owner: "runner-2".into(),
                        generation: retried.lease_generation,
                    },
                    vec![(EntityKey("Thing:1".into()), real.clone())],
                )
                .await
                .unwrap()
        );
        assert_eq!(
            storage
                .get_batch(&[EntityKey("Thing:1".into())])
                .await
                .unwrap()[0],
            Some(real)
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap()[0].id, second);
    });
}
