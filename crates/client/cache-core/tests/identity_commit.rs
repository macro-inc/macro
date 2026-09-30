//! A successful server response with invalid identity data must never be replayed.

use cache_core::engine::{
    BeginOptimisticWrite, CommitOptimisticWriteResult, Engine, EngineError, ReadResult,
};
use cache_core::identity::IdentityBinding;
use cache_core::link_patch::{
    LinkOperation, LinkPathSegment, ListItemByScalar, OptimisticLinkPatch, QueryRevalidation,
};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken, MutationId};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey};
use pollster::block_on;
use serde_json::{Value, json};

const MUTATION: &str = "mutation Save { setEntityProperty { __typename id displayName } }";
const UUID: &str = "11111111-1111-4111-8111-111111111111";

async fn enqueue(engine: &mut Engine<InMemoryStorage>, uuid: &str) -> MutationId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                uuid,
                query: MUTATION,
                operation_name: None,
                variables: &Default::default(),
                data: &json!({"setEntityProperty": {"__typename": "GraphqlProperty", "id": "local", "displayName": "pending"}}),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: &[IdentityBinding {
                    local_key: EntityKey("GraphqlProperty:local".into()),
                    delete_record: false,
                    response_path: vec!["setEntityProperty".into()],
                    reference_fields: vec![],
                    revalidation_variables: vec![],
                }],
            },
        )
        .await
        .unwrap()
        .0
}

async fn claim(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 0,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    }
}

#[test]
fn unnormalizable_responses_with_invalid_identities_are_permanently_discarded() {
    block_on(async {
        for data in [
            json!({"setEntityProperty": {"displayName": "missing id"}}),
            json!({"setEntityProperty": {"__typename": "Other", "id": "server"}}),
        ] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let transaction = enqueue(&mut engine, UUID).await;
            let token = claim(&mut engine).await;
            let outcome = engine
                .commit_optimistic_write_with_outcome(
                    transaction,
                    token,
                    MUTATION,
                    None,
                    &Default::default(),
                    &data,
                )
                .await
                .unwrap();
            let CommitOptimisticWriteResult::Failed(failed) = outcome else {
                panic!("expected permanent failure for {data}");
            };
            assert!(!failed.error.is_empty());
            assert!(failed.write_result.revision_advanced);
            assert_eq!(failed.write_result.mutation_uuid.as_deref(), Some(UUID));
            assert!(failed.replacement_transaction_id.is_none());
            let mut restarted = Engine::new(engine.into_storage());
            assert!(
                restarted
                    .storage()
                    .load_mutation_queue()
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(
                restarted
                    .claim_next_mutation(MutationClaimRequest {
                        owner: "restart".into(),
                        now_ms: 200,
                        lease_expires_at_ms: 300,
                    })
                    .await
                    .unwrap()
                    .is_none()
            );
            assert_eq!(
                restarted
                    .storage()
                    .get_batch(&[EntityKey("GraphqlProperty:local".into())])
                    .await
                    .unwrap(),
                vec![None]
            );
        }
    });
}

const ALIASED_MUTATION: &str = "mutation Save { saved: setEntityProperty { __typename id displayName } other: setEntityProperty { __typename id displayName } }";
const PROPERTIES: &str = "query Properties { user { id soup { items { __typename id properties { id displayName } } } } }";

fn aliased_response(first: &str, second: &str) -> Value {
    json!({
        "saved": {"__typename": "GraphqlProperty", "id": first, "displayName": "saved first"},
        "other": {"__typename": "GraphqlProperty", "id": second, "displayName": "saved second"},
    })
}

async fn enqueue_aliased(engine: &mut Engine<InMemoryStorage>) -> MutationId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                uuid: UUID,
                query: ALIASED_MUTATION,
                operation_name: None,
                variables: &Default::default(),
                data: &aliased_response("local", "other-local"),
                identity_bindings: &[
                    IdentityBinding {
                        local_key: EntityKey("GraphqlProperty:local".into()),
                        response_path: vec!["setEntityProperty".into()], // Stale path: query now aliases this field.
                        delete_record: false,
                        reference_fields: vec![],
                        revalidation_variables: vec!["id".into()],
                    },
                    IdentityBinding {
                        local_key: EntityKey("GraphqlProperty:other-local".into()),
                        response_path: vec!["other".into()],
                        delete_record: false,
                        reference_fields: vec![],
                        revalidation_variables: vec![],
                    },
                ],
                link_patches: &[OptimisticLinkPatch {
                    query: PROPERTIES.into(),
                    operation_name: None,
                    variables_json: "{}".into(),
                    path: vec![
                        LinkPathSegment::Field {
                            field: "user".into(),
                        },
                        LinkPathSegment::Field {
                            field: "soup".into(),
                        },
                        LinkPathSegment::Field {
                            field: "items".into(),
                        },
                        LinkPathSegment::ListItem {
                            list_item: ListItemByScalar {
                                where_field: "id".into(),
                                equals: json!("doc"),
                            },
                        },
                        LinkPathSegment::Field {
                            field: "properties".into(),
                        },
                    ],
                    operation: LinkOperation::PrependUnique {
                        entity_key: EntityKey("GraphqlProperty:local".into()),
                    },
                }],
                revalidations: &[QueryRevalidation {
                    query: PROPERTIES.into(),
                    operation_name: None,
                    variables_json: r#"{"id":"local"}"#.into(),
                }],
                created_at_ms: 0,
            },
        )
        .await
        .unwrap()
        .0
}

#[test]
fn binding_error_commits_server_data_and_valid_aliases_without_speculative_links() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                MUTATION,
                None,
                &Default::default(),
                &json!({"setEntityProperty": {"id": "local", "displayName": "old"}}),
                None,
            )
            .await
            .unwrap();
        engine.write_query(None, PROPERTIES, None, &Default::default(),
            &json!({"user": {"id": "user", "soup": {"items": [{"__typename": "GraphqlSoupDocument", "id": "doc", "properties": []}]}}}), None).await.unwrap();
        let transaction = enqueue_aliased(&mut engine).await;
        let token = claim(&mut engine).await;
        let outcome = engine
            .commit_optimistic_write_with_outcome(
                transaction,
                token,
                ALIASED_MUTATION,
                None,
                &Default::default(),
                &aliased_response("server", "other-server"),
            )
            .await
            .unwrap();
        let CommitOptimisticWriteResult::Committed(committed) = outcome else {
            panic!("server response should commit");
        };
        assert_eq!(
            committed.identity_errors,
            vec!["missing identity response object"]
        );
        assert!(committed.revalidations.is_empty());
        assert!(
            committed
                .changed
                .contains(&EntityKey("GraphqlProperty:server".into()))
        );
        let mut restarted = Engine::new(engine.into_storage());
        assert!(
            restarted
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        let records = restarted
            .storage()
            .get_batch(&[
                EntityKey("GraphqlProperty:server".into()),
                EntityKey("GraphqlProperty:local".into()),
                EntityKey("GraphqlProperty:other-local".into()),
            ])
            .await
            .unwrap();
        assert_eq!(
            records[0].as_ref().unwrap().fields["displayName"],
            CacheValue::String("saved first".into())
        );
        assert!(cache_core::identity::alias_target(records[1].as_ref().unwrap()).is_none());
        assert_eq!(
            cache_core::identity::alias_target(records[2].as_ref().unwrap()),
            Some(&EntityKey("GraphqlProperty:other-server".into()))
        );
        let ReadResult::Hit { data } = restarted
            .read_query(None, PROPERTIES, None, &Default::default())
            .await
            .unwrap()
        else {
            panic!("base query stays readable");
        };
        assert_eq!(data["user"]["soup"]["items"][0]["properties"], json!([]));
        assert!(
            restarted
                .claim_next_mutation(MutationClaimRequest {
                    owner: "restart".into(),
                    now_ms: 200,
                    lease_expires_at_ms: 300
                })
                .await
                .unwrap()
                .is_none()
        );
    });
}

#[test]
fn binding_error_preserves_newer_intent_and_a_later_response_can_resolve_its_identity() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.write_query(None, PROPERTIES, None, &Default::default(),
            &json!({"user": {"id": "user", "soup": {"items": [{"__typename": "GraphqlSoupDocument", "id": "doc", "properties": []}]}}}), None).await.unwrap();
        let transaction = enqueue_aliased(&mut engine).await;
        let token = claim(&mut engine).await;
        // The newer save uses the current, valid binding and can settle independently.
        let replacement = enqueue(&mut engine, UUID).await;
        let outcome = engine
            .commit_optimistic_write_with_outcome(
                transaction,
                token,
                ALIASED_MUTATION,
                None,
                &Default::default(),
                &aliased_response("server", "other-server"),
            )
            .await
            .unwrap();
        let CommitOptimisticWriteResult::CommittedSuperseded(committed) = outcome else {
            panic!("expected superseded commit");
        };
        assert_eq!(committed.replacement_transaction_id, replacement);
        assert_eq!(committed.write_result.identity_errors.len(), 1);
        let mut restarted = Engine::new(engine.into_storage());
        let token = claim(&mut restarted).await;
        let result = restarted
            .commit_optimistic_write(
                replacement,
                token,
                MUTATION,
                None,
                &Default::default(),
                &json!({"setEntityProperty": {"id": "server", "displayName": "newer"}}),
            )
            .await
            .unwrap();
        assert!(result.identity_errors.is_empty());
        let records = restarted
            .storage()
            .get_batch(&[
                EntityKey("GraphqlProperty:local".into()),
                EntityKey("GraphqlProperty:server".into()),
            ])
            .await
            .unwrap();
        assert_eq!(
            cache_core::identity::alias_target(records[0].as_ref().unwrap()),
            Some(&EntityKey("GraphqlProperty:server".into()))
        );
        assert_eq!(
            records[1].as_ref().unwrap().fields["displayName"],
            CacheValue::String("newer".into())
        );
        assert!(
            restarted
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn failed_superseded_identity_preserves_and_unblocks_newer_intent() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let transaction = enqueue(&mut engine, UUID).await;
        let token = claim(&mut engine).await;
        let replacement = enqueue(&mut engine, UUID).await;
        let outcome = engine
            .commit_optimistic_write_with_outcome(
                transaction,
                token,
                MUTATION,
                None,
                &Default::default(),
                &Value::Null,
            )
            .await
            .unwrap();
        let CommitOptimisticWriteResult::Failed(failed) = outcome else {
            panic!("expected permanent failure");
        };
        assert_eq!(failed.replacement_transaction_id, Some(replacement));
        let mut restarted = Engine::new(engine.into_storage());
        let queued = restarted.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].id, replacement);
        claim(&mut restarted).await;
    });
}

#[test]
fn invalid_identity_does_not_discard_a_stale_claim() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let transaction = enqueue(&mut engine, UUID).await;
        let mut token = claim(&mut engine).await;
        token.generation += 1;
        let error = engine
            .commit_optimistic_write_with_outcome(
                transaction,
                token,
                MUTATION,
                None,
                &Default::default(),
                &Value::Null,
            )
            .await
            .unwrap_err();
        assert!(matches!(error, EngineError::StaleMutationClaim(_)));
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap().len(),
            1
        );
    });
}

#[test]
fn valid_identity_absent_from_normalization_keeps_existing_error_behavior() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let transaction = enqueue(&mut engine, UUID).await;
        let token = claim(&mut engine).await;
        let error = engine.commit_optimistic_write_with_outcome(
            transaction, token, "mutation Save { other: setEntityProperty { id displayName } }", None,
            &Default::default(), &json!({"setEntityProperty": {"__typename": "GraphqlProperty", "id": "server", "displayName": "saved"}}),
        ).await.unwrap_err();
        assert!(
            matches!(error, EngineError::InvalidOptimisticProjection(ref detail)
            if detail == "identity target is absent from normalized response")
        );
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap().len(),
            1
        );
    });
}
