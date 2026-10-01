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
                    record_root: None,
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

#[test]
fn cross_inbox_draft_settlement_preserves_source_thread_and_rebases_queued_edits() {
    block_on(async {
        const SAVE: &str = "mutation SaveEmailDraft { saveEmailDraft { draft { id threadId subject } thread { id messages(offset: 0, limit: 20) { id subject } } } }";
        const PAGE: &str = "query EmailThreadPage($threadId: ID!) { user { id emailThread(input: { threadId: $threadId }) { id messages(offset: 0, limit: 20) { id subject } } } }";
        let variables = json!({ "threadId": "source-thread" })
            .as_object()
            .unwrap()
            .clone();
        let source = json!({ "user": { "id": "viewer", "emailThread": {
            "id": "source-thread", "messages": [{ "id": "received", "subject": "Original conversation" }]
        } } });
        let bindings = [
            IdentityBinding {
                local_key: EntityKey("GraphqlSoupEmailMessage:local-draft".into()),
                response_path: vec!["saveEmailDraft".into(), "draft".into()],
                delete_record: false,
                reference_fields: vec![],
                revalidation_variables: vec![],
            },
            // This is an existing source conversation, not a local handle for
            // the new destination conversation returned by a cross-inbox save.
            IdentityBinding {
                local_key: EntityKey("GraphqlSoupEmailThread:source-thread".into()),
                response_path: vec![],
                delete_record: false,
                reference_fields: vec!["GraphqlSoupEmailMessage.threadId".into()],
                revalidation_variables: vec!["threadId".into()],
            },
        ];
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, PAGE, None, &variables, &source, None)
            .await
            .unwrap();
        let pending = |subject| {
            json!({ "saveEmailDraft": {
            "draft": { "id": "local-draft", "threadId": "source-thread", "subject": subject },
            "thread": { "id": "source-thread", "messages": [
                { "id": "local-draft", "subject": subject },
                { "id": "received", "subject": "Original conversation" }
            ] }
        } })
        };
        let mut transactions = Vec::new();
        let mut first_claim = None;
        for subject in ["First edit", "Newer edit"] {
            let transaction = engine
                .begin_optimistic_write(
                    None,
                    BeginOptimisticWrite {
                        uuid: UUID,
                        query: SAVE,
                        operation_name: None,
                        variables: &Default::default(),
                        data: &pending(subject),
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 0,
                        identity_bindings: &bindings,
                    },
                )
                .await
                .unwrap()
                .0;
            transactions.push(transaction);
            if first_claim.is_none() {
                first_claim = Some(claim(&mut engine).await);
            }
        }
        // The snapshot uses the thread page's exact message arguments, keeping
        // an offline reply reopenable without a link patch reapplied at commit.
        let mut engine = Engine::new(engine.into_storage());
        let ReadResult::Hit { data } = engine
            .read_query(None, PAGE, None, &variables)
            .await
            .unwrap()
        else {
            panic!("the queued reply must remain reopenable after restart");
        };
        assert_eq!(data["user"]["emailThread"]["id"], "source-thread");
        assert_eq!(
            data["user"]["emailThread"]["messages"],
            pending("Newer edit")["saveEmailDraft"]["thread"]["messages"]
        );
        let committed = |subject| {
            json!({ "saveEmailDraft": {
            "draft": { "id": "server-draft", "threadId": "destination-thread", "subject": subject },
            "thread": { "id": "destination-thread", "messages": [{ "id": "server-draft", "subject": subject }] }
        } })
        };
        let outcome = engine
            .commit_optimistic_write_with_outcome(
                transactions[0],
                first_claim.unwrap(),
                SAVE,
                None,
                &Default::default(),
                &committed("First edit"),
            )
            .await
            .unwrap();
        let CommitOptimisticWriteResult::CommittedSuperseded(result) = outcome else {
            panic!("the older save must commit beneath the newer edit");
        };
        assert_eq!(result.replacement_transaction_id, transactions[1]);

        let mut engine = Engine::new(engine.into_storage());
        let selection = cache_core::record_selection::RecordSelection::parse(
            "fragment Draft on GraphqlSoupEmailMessage { id subject }",
            "Draft",
        )
        .unwrap();
        let draft = engine
            .read_records_by_keys(
                &selection,
                &[EntityKey("GraphqlSoupEmailMessage:local-draft".into())],
            )
            .await
            .unwrap();
        assert_eq!(
            draft.value[0].record,
            json!({ "id": "server-draft", "subject": "Newer edit" })
        );
        assert!(draft.value[0].identity.pending);
        let ReadResult::Hit { data } = engine
            .read_query(None, PAGE, None, &variables)
            .await
            .unwrap()
        else {
            panic!("source conversation remains readable while the newer edit is pending");
        };
        assert_eq!(data["user"]["emailThread"]["id"], "source-thread");
        assert_eq!(
            data["user"]["emailThread"]["messages"],
            json!([
                { "id": "server-draft", "subject": "Newer edit" },
                { "id": "received", "subject": "Original conversation" }
            ])
        );

        let token = claim(&mut engine).await;
        engine
            .commit_optimistic_write(
                transactions[1],
                token,
                SAVE,
                None,
                &Default::default(),
                &committed("Newer edit"),
            )
            .await
            .unwrap();
        let mut engine = Engine::new(engine.into_storage());
        let ReadResult::Hit { data } = engine
            .read_query(None, PAGE, None, &variables)
            .await
            .unwrap()
        else {
            panic!("source conversation remains readable after restart");
        };
        assert_eq!(data, source);
        let source_record = engine
            .storage()
            .get_batch(&[EntityKey("GraphqlSoupEmailThread:source-thread".into())])
            .await
            .unwrap();
        assert!(cache_core::identity::alias_target(source_record[0].as_ref().unwrap()).is_none());
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn rollback_after_restart_returns_persisted_revalidations_with_resolved_ids() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut transactions = Vec::new();
        let mut first_claim = None;
        for name in ["First edit", "Newer edit"] {
            let transaction = engine
                .begin_optimistic_write(
                    None,
                    BeginOptimisticWrite {
                        uuid: UUID,
                        query: MUTATION,
                        operation_name: None,
                        variables: &Default::default(),
                        data: &json!({"setEntityProperty": {"id": "local", "displayName": name}}),
                        link_patches: &[],
                        revalidations: &[QueryRevalidation {
                            query: PROPERTIES.into(),
                            operation_name: Some("Properties".into()),
                            variables_json: r#"{"id":"local"}"#.into(),
                        }],
                        identity_bindings: &[IdentityBinding {
                            local_key: EntityKey("GraphqlProperty:local".into()),
                            response_path: vec!["setEntityProperty".into()],
                            delete_record: false,
                            reference_fields: vec![],
                            revalidation_variables: vec!["id".into()],
                        }],
                        created_at_ms: 0,
                    },
                )
                .await
                .unwrap()
                .0;
            transactions.push(transaction);
            if first_claim.is_none() {
                first_claim = Some(claim(&mut engine).await);
            }
        }
        engine
            .commit_optimistic_write_with_outcome(
                transactions[0],
                first_claim.unwrap(),
                MUTATION,
                None,
                &Default::default(),
                &json!({"setEntityProperty": {"id": "server", "displayName": "First edit"}}),
            )
            .await
            .unwrap();
        let mut restarted = Engine::new(engine.into_storage());
        let token = claim(&mut restarted).await;
        let outcome = restarted
            .rollback_optimistic_write_with_outcome(transactions[1], token)
            .await
            .unwrap();
        let cache_core::engine::RollbackOptimisticWriteResult::RolledBack(result) = outcome else {
            panic!("the current intent must fail permanently");
        };
        assert_eq!(
            result.revalidations,
            vec![QueryRevalidation {
                query: PROPERTIES.into(),
                operation_name: Some("Properties".into()),
                variables_json: r#"{"id":"server"}"#.into(),
            }]
        );
        assert_eq!(result.mutation_uuid.as_deref(), Some(UUID));
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
