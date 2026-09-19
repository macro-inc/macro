use cache_core::predicate::OptimisticUpsertReconciliation;
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, MutationUpsertKind,
    NewQueuedMutation, OptimisticSource, PersistedOptimisticLayer, StoredMutation,
    decode_optimistic_source, encode_optimistic_source,
};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use predicate_index::{
    ExactAttributePatch, ExactValue, IndexDocument, IntegerAttributePatch, IntegerFact,
    OptimisticProjectionMutation, Profile, RecordKey, Token,
};
use serde_json::json;

#[test]
fn optimistic_source_supports_versioned_and_legacy_json() {
    let source = OptimisticSource {
        mutation_data: json!({"rename": {"name": "next"}}),
        link_patches: Vec::new(),
        revalidations: Vec::new(),
        projection_mutations: vec![
            OptimisticProjectionMutation::Replace(IndexDocument {
                record_key: RecordKey::new("GraphqlSoupDocument:doc-1").unwrap(),
                profile: Profile::new(Token::new("soup-flat-v1").unwrap()),
                partition: Token::new("document").unwrap(),
                exact_facts: Vec::new(),
                integer_facts: Vec::new(),
                sort_facts: vec![IntegerFact {
                    attribute: Token::new("updated-at").unwrap(),
                    value: 10,
                }],
            }),
            OptimisticProjectionMutation::Patch {
                record_key: RecordKey::new("GraphqlSoupDocument:doc-2").unwrap(),
                profile: Profile::new(Token::new("soup-flat-v1").unwrap()),
                partition: Token::new("document").unwrap(),
                exact: vec![ExactAttributePatch {
                    attribute: Token::new("owner").unwrap(),
                    values: vec![ExactValue::utf8("user-1").unwrap()],
                }],
                integers: vec![IntegerAttributePatch {
                    attribute: Token::new("updated-at").unwrap(),
                    values: vec![20],
                }],
                sorts: vec![IntegerFact {
                    attribute: Token::new("updated-at").unwrap(),
                    value: 20,
                }],
            },
        ],
    };
    assert_eq!(
        decode_optimistic_source(&encode_optimistic_source(&source)).unwrap(),
        source
    );
    assert_eq!(
        decode_optimistic_source(
            r#"{"version":2,"mutationData":{"name":"collision"},"rename":{"name":"legacy"}}"#
        )
        .unwrap()
        .mutation_data,
        json!({
            "version": 2,
            "mutationData": {"name": "collision"},
            "rename": {"name": "legacy"}
        })
    );

    let legacy_v2 = decode_optimistic_source(
        r#"@macro-cache/optimistic-source:{"version":2,"mutationData":{"rename":{"name":"legacy"}},"linkPatches":[],"revalidations":[]}"#,
    )
    .unwrap();
    assert_eq!(
        legacy_v2.mutation_data,
        json!({"rename": {"name": "legacy"}})
    );
    assert!(legacy_v2.projection_mutations.is_empty());
    assert!(
        decode_optimistic_source(
            r#"@macro-cache/optimistic-source:{"version":2,"mutationData":{},"projectionMutations":[]}"#,
        )
        .is_err(),
        "version 2 must not silently accept a projection overlay"
    );
}

fn queued(value: &str, created_at_ms: i64) -> NewQueuedMutation {
    let mut update = Record::default();
    update
        .fields
        .insert("name".into(), CacheValue::String(value.into()));
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, value.as_bytes()),
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
fn queue_diagnostics_are_payload_free_and_track_oldest() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        assert_eq!(
            storage.queue_diagnostics().await.unwrap(),
            cache_core::store::QueueDiagnostics {
                availability: cache_core::store::QueueDiagnosticsAvailability::Available,
                depth: 0,
                oldest_created_at_ms: None,
            }
        );
        let first = storage
            .enqueue_mutation(queued("secret-a", 42))
            .await
            .unwrap();
        storage
            .enqueue_mutation(queued("secret-b", 21))
            .await
            .unwrap();
        assert_eq!(
            storage.queue_diagnostics().await.unwrap(),
            cache_core::store::QueueDiagnostics {
                availability: cache_core::store::QueueDiagnosticsAvailability::Available,
                depth: 2,
                oldest_created_at_ms: Some(21),
            }
        );
        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 100,
                lease_expires_at_ms: 200,
            })
            .await
            .unwrap()
            .unwrap();
        storage
            .discard_mutation(
                first,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claimed.lease_generation,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            storage.queue_diagnostics().await.unwrap(),
            cache_core::store::QueueDiagnostics {
                availability: cache_core::store::QueueDiagnosticsAvailability::Available,
                depth: 1,
                oldest_created_at_ms: Some(21),
            }
        );
    });
}

#[test]
fn storage_upsert_reports_pending_and_active_uuid_collisions() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let uuid = uuid::Uuid::new_v4();
        let mut first = queued("a", 1);
        first.uuid = uuid;
        let first = storage
            .upsert_mutation_with_shadow(first, 1, OptimisticUpsertReconciliation::default())
            .await
            .unwrap();
        assert_eq!(first.kind, MutationUpsertKind::Inserted);

        let mut pending = queued("b", 2);
        pending.uuid = uuid;
        let pending = storage
            .upsert_mutation_with_shadow(pending, 2, OptimisticUpsertReconciliation::default())
            .await
            .unwrap();
        assert_eq!(
            pending.kind,
            MutationUpsertKind::ReplacedPending {
                removed_id: first.id
            }
        );
        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 3,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, pending.id);

        let mut active = queued("c", 4);
        active.uuid = uuid;
        let active = storage
            .upsert_mutation_with_shadow(active, 4, OptimisticUpsertReconciliation::default())
            .await
            .unwrap();
        assert_eq!(
            active.kind,
            MutationUpsertKind::AppendedAfterActive {
                active_id: pending.id
            }
        );
        let queue = storage.load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 2);
        assert!(queue[0].superseded);
        assert_eq!(queue[1].id, active.id);
    });
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
