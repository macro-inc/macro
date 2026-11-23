use super::*;
use crate::store::InMemoryStorage;
use pollster::block_on;
use serde_json::json;

#[test]
fn stale_enqueue_derives_query_link_repair_before_current_generation_settlement() {
    block_on(async {
        for explicit in [false, true] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let authority = engine.current_authority("profile").await.unwrap();
            let query = "mutation Save { saveEmailDraft { thread { __typename id name } } }";
            let data = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"retired"}}});
            let patch: OptimisticLinkPatch = serde_json::from_value(json!({
                "query": "query Thread($threadId: String!) { user { emailThread(id: $threadId) { id messages { id } } } }",
                "operationName": "Thread", "variablesJson": "{\"threadId\":\"thread\"}",
                "path": [{"field":"user"},{"field":"emailThread"},{"field":"messages"}],
                "operation": {"kind":"prependUnique", "entityKey":"GraphqlSoupEmailMessage:draft"}
            })).unwrap();
            let repair = patch.revalidation().unwrap();
            let mut fragment = patch.clone();
            fragment.record_root = Some(crate::link_patch::RecordRoot {
                fragment_name: "ThreadMessages".into(),
                entity_key: EntityKey("GraphqlSoupEmailThread:thread".into()),
            });
            fragment.query =
                "fragment ThreadMessages on GraphqlSoupEmailThread { id messages { id } }".into();
            fragment.operation_name = None;
            fragment.variables_json = "{}".into();
            let queued = engine
                .enqueue_optimistic_mutation_in_generation(
                    None,
                    BeginOptimisticWrite {
                        task_dependency_recipe: None,
                        client_metadata: None,
                        identity_bindings: &[],
                        uuid: "00000000-0000-4000-8000-000000000081",
                        query,
                        operation_name: Some("Save"),
                        variables: &Default::default(),
                        data: &data,
                        link_patches: &[patch.clone(), patch, fragment],
                        revalidations: if explicit {
                            std::slice::from_ref(&repair)
                        } else {
                            &[]
                        },
                        created_at_ms: 1,
                    },
                    MutationClaimRequest {
                        owner: "writer".into(),
                        now_ms: 2,
                        lease_expires_at_ms: 100,
                    },
                    OptimisticEffects::default(),
                    Some(Uuid::nil()),
                )
                .await
                .unwrap();
            let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
                panic!("command must be claimed")
            };
            let stored = engine.storage().load_mutation_queue().await.unwrap();
            let source =
                decode_optimistic_source(&stored[0].optimistic.optimistic_data_json).unwrap();
            assert_eq!(source.revalidations, vec![repair.clone()]);
            assert_eq!(source.mutation_data, json!({}));
            assert!(source.link_patches.is_empty());
            assert!(stored[0].optimistic.normalized_updates.is_empty());
            let response = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"confirmed"}}});
            let result = engine
                .commit_optimistic_write_in_generation(
                    queued.transaction_id,
                    MutationClaimToken {
                        owner: "writer".into(),
                        generation: claimed.lease_generation,
                    },
                    NetworkWrite {
                        query,
                        operation_name: Some("Save"),
                        variables: &Default::default(),
                        data: &response,
                        identity: None,
                    },
                    vec![],
                    Some(authority.generation),
                )
                .await
                .unwrap();
            let CommitOptimisticWriteResult::Committed(result) = result else {
                panic!("current response must settle")
            };
            assert_eq!(result.revalidations, vec![repair]);
            assert!(
                engine
                    .storage()
                    .load_mutation_queue()
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    });
}

#[test]
fn stale_commands_keep_fresh_revalidations_through_retirement_and_settlement() {
    block_on(async {
        for enqueue_stale in [false, true] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let initial = engine.current_authority("profile").await.unwrap();
            let query = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id name } } }";
            let variables = json!({"input":{"threadId":"thread","bodyText":"authored"}});
            let data = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"retired"}}});
            let repair = QueryRevalidation {
                query: "{ user { id } }".into(),
                operation_name: None,
                variables_json: "{}".into(),
                only_on_link_failure: true,
            };
            let queued = engine
                .enqueue_optimistic_mutation_in_generation(
                    None,
                    BeginOptimisticWrite {
                        task_dependency_recipe: None,
                        client_metadata: None,
                        identity_bindings: &[],
                        uuid: "00000000-0000-4000-8000-000000000080",
                        query,
                        operation_name: Some("Save"),
                        variables: variables.as_object().unwrap(),
                        data: &data,
                        link_patches: &[],
                        revalidations: std::slice::from_ref(&repair),
                        created_at_ms: 1,
                    },
                    MutationClaimRequest {
                        owner: "writer".into(),
                        now_ms: 2,
                        lease_expires_at_ms: 100,
                    },
                    OptimisticEffects::default(),
                    Some(if enqueue_stale {
                        Uuid::nil()
                    } else {
                        initial.generation
                    }),
                )
                .await
                .unwrap();
            let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
                panic!("command must be claimed")
            };
            engine
                .retire_optimistic_snapshots_where(|_, _| true)
                .await
                .unwrap();
            let stored = engine.storage().load_mutation_queue().await.unwrap();
            let source =
                decode_optimistic_source(&stored[0].optimistic.optimistic_data_json).unwrap();
            assert_eq!(source.revalidations, vec![repair.clone()]);
            assert_eq!(source.mutation_data, json!({}));
            let result = engine
                .commit_optimistic_write_in_generation(
                    queued.transaction_id,
                    MutationClaimToken {
                        owner: "writer".into(),
                        generation: claimed.lease_generation,
                    },
                    NetworkWrite {
                        query,
                        operation_name: Some("Save"),
                        variables: variables.as_object().unwrap(),
                        data: &data,
                        identity: None,
                    },
                    vec![],
                    Some(Uuid::nil()),
                )
                .await
                .unwrap();
            let CommitOptimisticWriteResult::Committed(result) = result else {
                panic!("must settle")
            };
            assert_eq!(result.revalidations, vec![repair]);
            assert!(
                engine
                    .storage()
                    .load_mutation_queue()
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(
                engine
                    .storage()
                    .get_batch(&[EntityKey("GraphqlSoupEmailThread:thread".into())])
                    .await
                    .unwrap()[0]
                    .is_none()
            );
        }
    });
}

#[test]
fn retirement_recomposes_shared_projection_shadows_in_both_layer_orders() {
    block_on(async {
        use predicate_index::{
            IndexDocument, IntegerAttributePatch, OptimisticProjectionMutation,
            OptimisticProjectionState, Profile, RecordKey, Token,
        };
        for (aliased, retired_index) in [false, true]
            .into_iter()
            .flat_map(|aliased| [0, 1].map(move |retired_index| (aliased, retired_index)))
        {
            let mut engine = Engine::new(InMemoryStorage::new());
            let key = RecordKey::new("GraphqlSoupDocument:shared").unwrap();
            let local = EntityKey("GraphqlSoupDocument:local".into());
            let source_key = if aliased {
                RecordKey::new(local.0.as_ref()).unwrap()
            } else {
                key.clone()
            };
            let bindings = if aliased {
                vec![IdentityBinding {
                    local_key: local.clone(),
                    delete_record: false,
                    response_path: vec![],
                    reference_fields: vec![],
                    revalidation_variables: vec![],
                }]
            } else {
                vec![]
            };
            let profile = Profile::new(Token::new("retirement-test").unwrap());
            let partition = Token::new("documents").unwrap();
            engine
                .put_records_with_projections(
                    None,
                    if aliased {
                        vec![(
                            local,
                            identity::alias_record(&EntityKey("GraphqlSoupDocument:shared".into())),
                        )]
                    } else {
                        vec![]
                    },
                    vec![ProjectionMutation::Replace(IndexDocument {
                        record_key: key.clone(),
                        profile: profile.clone(),
                        partition: partition.clone(),
                        exact_facts: vec![],
                        integer_facts: vec![],
                        sort_facts: vec![],
                    })],
                )
                .await
                .unwrap();
            let mut ids = Vec::new();
            for (index, attribute) in ["older", "newer"].into_iter().enumerate() {
                let result = engine.begin_optimistic_write_with_projections(None, BeginOptimisticWrite {
                    task_dependency_recipe: None,
                    client_metadata: None, identity_bindings: &bindings, uuid: &format!("00000000-0000-4000-8000-00000000009{index}"),
                    query: "mutation Rename($inputs: [RenameEntityInput!]!) { renameEntities(inputs: $inputs) { results { __typename } } }",
                    operation_name: Some("Rename"), variables: json!({"inputs":[]}).as_object().unwrap(), data: &json!({}),
                    link_patches: &[], revalidations: &[], created_at_ms: 1,
                }, vec![OptimisticProjectionMutation::Patch {
                    record_key: source_key.clone(), profile: profile.clone(), partition: partition.clone(),
                    exact: vec![], integers: vec![IntegerAttributePatch { attribute: Token::new(attribute).unwrap(), values: vec![1] }], sorts: vec![],
                }]).await.unwrap();
                ids.push(result.0);
            }
            engine
                .retire_optimistic_snapshots_where(|entry, _| entry.id == ids[retired_index])
                .await
                .unwrap();
            let mut reopened = Engine::new(engine.into_storage());
            let shadows = reopened
                .storage()
                .load_optimistic_projections(std::slice::from_ref(&key))
                .await
                .unwrap();
            let shadow = shadows[0]
                .as_ref()
                .expect("surviving layer must remain projected");
            assert_eq!(shadow.owner, ids[1 - retired_index]);
            let OptimisticProjectionState::Complete(document) = &shadow.state else {
                panic!("base remains complete")
            };
            assert_eq!(document.integer_facts.len(), 1);
            assert_eq!(
                document.integer_facts[0].attribute,
                Token::new(["newer", "older"][retired_index]).unwrap()
            );
            reopened
                .retire_optimistic_snapshots_where(|_, _| true)
                .await
                .unwrap();
            let reopened = Engine::new(reopened.into_storage());
            assert!(
                reopened
                    .storage()
                    .load_optimistic_projections(&[key])
                    .await
                    .unwrap()[0]
                    .is_none()
            );
        }
    });
}

#[test]
fn malformed_authority_is_not_a_fresh_unproven_cache() {
    block_on(async {
        for state in [
            CacheValue::String("wrong type".into()),
            CacheValue::Opaque("{broken".into()),
        ] {
            let mut storage = InMemoryStorage::new();
            let marker = Record {
                fields: [(AUTHORITY_FIELD.into(), state)].into(),
            };
            storage
                .put_batch(vec![(EntityKey(AUTHORITY_KEY.into()), marker.clone())])
                .await
                .unwrap();
            let mut engine = Engine::new(storage);
            assert!(matches!(
                engine.current_authority("profile").await,
                Err(EngineError::InvalidAuthority)
            ));
            assert!(matches!(
                engine.unfinished_retirement().await,
                Err(EngineError::InvalidAuthority)
            ));
            assert_eq!(
                engine
                    .storage()
                    .get_batch(&[EntityKey(AUTHORITY_KEY.into())])
                    .await
                    .unwrap(),
                vec![Some(marker)]
            );
        }
    });
}

impl<S: Storage> Engine<S> {
    async fn check_snapshot_generation(
        &mut self,
        generation: Option<Uuid>,
    ) -> Result<(), EngineError<S::Error>> {
        if self.snapshot_is_current(generation).await? {
            Ok(())
        } else {
            Err(EngineError::StaleAuthority)
        }
    }
}

#[test]
fn retirement_strips_projection_only_sources_and_preserves_other_queued_owners() {
    block_on(async {
        use predicate_index::{
            IndexDocument, OptimisticProjectionMutation, Profile, RecordKey, Token,
        };
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut keys = Vec::new();
        for (kind, uuid) in [
            (
                "GraphqlSoupCrmContact",
                "00000000-0000-4000-8000-000000000010",
            ),
            (
                "GraphqlSoupDocument",
                "00000000-0000-4000-8000-000000000011",
            ),
        ] {
            let key = RecordKey::new(format!("{kind}:record")).unwrap();
            engine
                .begin_optimistic_write_with_projections(
                    None,
                    BeginOptimisticWrite {
                        task_dependency_recipe: None,
                        client_metadata: Some(&json!({"intent":"keep command"})),
                        identity_bindings: &[],
                        uuid,
                        query: "mutation Rename($inputs: [RenameEntityInput!]!) { renameEntities(inputs: $inputs) { results { __typename } } }",
                        operation_name: Some("Rename"),
                        variables: json!({"inputs":[{"entity":{"type":"DOCUMENT","id":"record"},"displayName":"authored name"}]}).as_object().unwrap(),
                        data: &json!({}),
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 17,
                    },
                    vec![OptimisticProjectionMutation::Replace(IndexDocument {
                        record_key: key.clone(),
                        profile: Profile::new(Token::new("authority-test").unwrap()),
                        partition: Token::new("items").unwrap(),
                        exact_facts: vec![],
                        integer_facts: vec![],
                        sort_facts: vec![],
                    })],
                )
                .await
                .unwrap();
            keys.push(key);
        }
        let before = engine.storage().load_mutation_queue().await.unwrap();
        assert!(
            before
                .iter()
                .all(|entry| entry.optimistic.normalized_updates.is_empty())
        );
        let shadows = engine
            .storage()
            .load_optimistic_projections(&keys)
            .await
            .unwrap();
        assert!(shadows.iter().all(Option::is_some));

        engine
            .retire_optimistic_snapshots(&["GraphqlSoupCrmContact".into()])
            .await
            .unwrap();
        let mut reopened = Engine::new(engine.into_storage());
        reopened.refresh_optimistic_queue().await.unwrap();
        let after = reopened.storage().load_mutation_queue().await.unwrap();
        assert_eq!(after.len(), before.len());
        for (before, after) in before.iter().zip(&after) {
            assert_eq!(before.id, after.id);
            assert_eq!(before.uuid, after.uuid);
            assert_eq!(before.superseded, after.superseded);
            assert_eq!(before.mutation, after.mutation);
        }
        let retired = decode_optimistic_source(&after[0].optimistic.optimistic_data_json).unwrap();
        assert!(retired.projection_mutations.is_empty());
        assert_eq!(
            retired.client_metadata,
            Some(json!({"intent":"keep command"}))
        );
        assert_eq!(after[1].optimistic, before[1].optimistic);
        let after_shadows = reopened
            .storage()
            .load_optimistic_projections(&keys)
            .await
            .unwrap();
        assert!(after_shadows[0].is_none());
        assert_eq!(after_shadows[1], shadows[1]);
    });
}

#[test]
fn stale_success_settles_the_command_and_identity_without_restoring_its_response() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.bind_identity("viewer").await.unwrap();
        let initial = engine.current_authority("viewer").await.unwrap();
        let allowed = engine
            .transition_authority("viewer", initial.generation, "team:allowed".into(), &[])
            .await
            .unwrap();
        let mutation = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id name snippet messages { __typename id bodyText } } } }";
        let variables = json!({"input":{"threadId":"local-thread","bodyText":"authored reply"}});
        let response = json!({"saveEmailDraft":{"thread":{
            "__typename":"GraphqlSoupEmailThread","id":"server-thread","name":"private subject","snippet":"private snippet",
            "messages":[{"__typename":"GraphqlSoupEmailMessage","id":"message","bodyText":"private message"}]
        }}});
        let local = EntityKey("GraphqlSoupEmailThread:local-thread".into());
        let target = EntityKey("GraphqlSoupEmailThread:server-thread".into());
        let binding = IdentityBinding {
            local_key: local.clone(),
            delete_record: false,
            response_path: vec!["saveEmailDraft".into(), "thread".into()],
            reference_fields: vec![],
            revalidation_variables: vec![],
        };
        let queued = engine
            .enqueue_optimistic_mutation_in_generation(
                None,
                BeginOptimisticWrite {
                    task_dependency_recipe: None,
                    client_metadata: None,
                    identity_bindings: &[binding],
                    uuid: "00000000-0000-4000-8000-000000000001",
                    query: mutation,
                    operation_name: Some("Save"),
                    variables: variables.as_object().unwrap(),
                    data: &response,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
                MutationClaimRequest {
                    owner: "client-a".into(),
                    now_ms: 2,
                    lease_expires_at_ms: 100,
                },
                OptimisticEffects::default(),
                Some(allowed.authority.generation),
            )
            .await
            .unwrap();
        let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
            panic!("command must be claimed")
        };
        let original = engine.storage().load_mutation_queue().await.unwrap()[0]
            .mutation
            .clone();
        let denied = engine
            .transition_authority(
                "viewer",
                allowed.authority.generation,
                "team:denied".into(),
                &[
                    "GraphqlSoupEmailThread".into(),
                    "GraphqlSoupEmailMessage".into(),
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap()[0].mutation,
            original
        );
        let result = engine
            .commit_optimistic_write_in_generation(
                queued.transaction_id,
                MutationClaimToken {
                    owner: "client-a".into(),
                    generation: claimed.lease_generation,
                },
                NetworkWrite {
                    query: mutation,
                    operation_name: Some("Save"),
                    variables: variables.as_object().unwrap(),
                    data: &response,
                    identity: Some("viewer"),
                },
                vec![],
                Some(allowed.authority.generation),
            )
            .await
            .unwrap();
        assert!(matches!(result, CommitOptimisticWriteResult::Committed(_)));
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        let rows = engine
            .storage()
            .get_batch(&[
                local,
                target.clone(),
                EntityKey("GraphqlSoupEmailMessage:message".into()),
            ])
            .await
            .unwrap();
        assert_eq!(
            identity::alias_target(rows[0].as_ref().unwrap()),
            Some(&target)
        );
        assert_eq!(
            rows[1].as_ref().unwrap().fields.get("id"),
            Some(&CacheValue::String("server-thread".into()))
        );
        assert!(!format!("{rows:?}").contains("private"));
        assert!(rows[2].is_none());
        engine
            .check_snapshot_generation(Some(denied.authority.generation))
            .await
            .unwrap();
    });
}

#[test]
fn an_old_windows_enqueue_keeps_authored_variables_but_no_copied_snapshot() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let initial = engine.current_authority("viewer").await.unwrap();
        engine
            .transition_authority("viewer", initial.generation, "team:denied".into(), &[])
            .await
            .unwrap();
        let variables = json!({"input":{"threadId":"thread","bodyText":"authored reply"}});
        engine.enqueue_optimistic_mutation_in_generation(
            None,
            BeginOptimisticWrite {
                task_dependency_recipe: None,
                client_metadata: None, identity_bindings: &[],
                uuid: "00000000-0000-4000-8000-000000000002",
                query: "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id name } } }",
                operation_name: Some("Save"), variables: variables.as_object().unwrap(),
                data: &json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"private"}}}),
                link_patches: &[], revalidations: &[], created_at_ms: 1,
            },
            MutationClaimRequest { owner: "client-a".into(), now_ms: 2, lease_expires_at_ms: 100 },
            OptimisticEffects::default(), Some(initial.generation),
        ).await.unwrap();
        let queued = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queued.len(), 1);
        assert!(
            queued[0]
                .mutation
                .request
                .variables_json
                .contains("authored reply")
        );
        assert!(
            !queued[0]
                .optimistic
                .optimistic_data_json
                .contains("private")
        );
        assert!(queued[0].optimistic.normalized_updates.is_empty());
    });
}

#[test]
fn another_clients_older_proof_cannot_restore_revoked_authority() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let initial = engine.current_authority("viewer").await.unwrap();
        assert!(
            engine
                .check_snapshot_generation(Some(initial.generation))
                .await
                .is_ok()
        );
        let allowed = engine
            .transition_authority("viewer", initial.generation, "team:allowed".into(), &[])
            .await
            .unwrap();
        let earlier_request = allowed.authority.generation;
        let stable = engine
            .transition_authority("viewer", earlier_request, "team:allowed".into(), &[])
            .await
            .unwrap();
        assert!(!stable.changed);
        assert_eq!(stable.authority.generation, earlier_request);
        let denied = engine
            .transition_authority("viewer", earlier_request, "team:denied".into(), &[])
            .await
            .unwrap();
        assert!(
            engine
                .check_snapshot_generation(Some(earlier_request))
                .await
                .is_err()
        );
        assert!(engine.check_snapshot_generation(None).await.is_ok());
        assert!(matches!(
            engine
                .transition_authority("viewer", earlier_request, "team:allowed".into(), &[])
                .await,
            Err(EngineError::StaleAuthority)
        ));
        assert_eq!(
            engine.current_authority("viewer").await.unwrap(),
            denied.authority
        );
        let granted = engine
            .transition_authority(
                "viewer",
                denied.authority.generation,
                "team:allowed".into(),
                &[],
            )
            .await
            .unwrap();
        engine
            .check_snapshot_generation(Some(granted.authority.generation))
            .await
            .unwrap();
        assert!(engine.current_authority("another-viewer").await.is_err());
    });
}

#[test]
fn retirement_removes_raw_children_and_preserves_unrelated_offline_records() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let company = EntityKey("GraphqlSoupCrmCompany:company".into());
        let thread = EntityKey("GraphqlSoupEmailThread:thread".into());
        let message = EntityKey("GraphqlSoupEmailMessage:message".into());
        let document = EntityKey("GraphqlSoupDocument:document".into());
        let alias = EntityKey("GraphqlSoupEmailThread:local".into());
        let content = Record {
            fields: [("name".into(), CacheValue::String("content".into()))].into(),
        };
        storage
            .put_batch(vec![
                (company.clone(), content.clone()),
                (thread.clone(), content.clone()),
                (message.clone(), content.clone()),
                (document.clone(), content.clone()),
                (alias.clone(), identity::alias_record(&thread)),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let storage_generation = engine.current_storage_generation().await.unwrap();
        let initial = engine.current_authority("viewer").await.unwrap();
        let result = engine
            .transition_authority(
                "viewer",
                initial.generation,
                "team:denied".into(),
                &[
                    "GraphqlSoupCrmCompany".into(),
                    "GraphqlSoupEmailThread".into(),
                    "GraphqlSoupEmailMessage".into(),
                ],
            )
            .await
            .unwrap();
        let records = engine
            .storage()
            .get_batch(&[company, thread.clone(), message, document, alias])
            .await
            .unwrap();
        assert_eq!(&records[..3], &[None, None, None]);
        assert_eq!(records[3], Some(content));
        assert_eq!(
            identity::alias_target(records[4].as_ref().unwrap()),
            Some(&thread)
        );
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            storage_generation
        );
        engine
            .check_snapshot_generation(Some(result.authority.generation))
            .await
            .unwrap();
    });
}

#[test]
fn reopening_an_interrupted_retirement_stays_closed_until_it_is_retried() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let initial = engine.current_authority("viewer").await.unwrap();
        let allowed = engine
            .transition_authority("viewer", initial.generation, "team:allowed".into(), &[])
            .await
            .unwrap();
        let query =
            "query { user { id emailThread(id: \"thread\") { __typename id name snippet } } }";
        engine.write_query(None, query, None, &Default::default(), &json!({
            "user": { "id": "viewer", "emailThread": {
                "__typename": "GraphqlSoupEmailThread", "id": "thread", "name": "private", "snippet": "private"
            }}
        }), None).await.unwrap();
        // A process may stop immediately after persisting the transition's
        // closed state, before deleting even the first protected record.
        let pending = engine
            .begin_authority_transition(
                "viewer",
                allowed.authority.generation,
                "team:denied".into(),
                true,
            )
            .await
            .unwrap();
        let mut reopened = Engine::new(engine.into_storage());
        assert!(
            reopened
                .check_snapshot_generation(Some(allowed.authority.generation))
                .await
                .is_err()
        );
        assert!(
            reopened
                .check_snapshot_generation(Some(pending.generation))
                .await
                .is_ok()
        );
        let observed = reopened.current_authority("viewer").await.unwrap();
        assert_eq!(observed, pending);
        let completed = reopened
            .transition_authority(
                "viewer",
                observed.generation,
                "team:denied".into(),
                &["GraphqlSoupEmailThread".into()],
            )
            .await
            .unwrap();
        reopened
            .check_snapshot_generation(Some(completed.authority.generation))
            .await
            .unwrap();
        assert!(matches!(
            reopened
                .read_query(None, query, None, &Default::default())
                .await
                .unwrap(),
            ReadResult::Miss
        ));
    });
}

#[test]
fn legacy_identity_hydrates_the_account_without_creating_a_permission_proof() {
    block_on(async {
        let mut legacy = Engine::new(InMemoryStorage::new());
        let query = "query Mail { user { id emailThread(id: \"own-thread\") { __typename id ownerId name } } }";
        let data = json!({
            "user": {
                "id": "viewer",
                "emailThread": {
                    "__typename": "GraphqlSoupEmailThread",
                    "id": "own-thread",
                    "ownerId": "viewer",
                    "name": "Personal subject"
                }
            }
        });
        legacy
            .write_query(
                None,
                query,
                Some("Mail"),
                &Default::default(),
                &data,
                Some("viewer"),
            )
            .await
            .unwrap();
        let metadata = legacy
            .storage()
            .get_batch(&[
                EntityKey("__meta:identity".into()),
                EntityKey(AUTHORITY_KEY.into()),
            ])
            .await
            .unwrap();
        assert!(metadata[0].is_some());
        assert!(metadata[1].is_none());

        let mut reopened = Engine::new(legacy.into_storage());
        let authority = reopened
            .current_authority("anonymous-profile")
            .await
            .unwrap();
        assert_eq!(authority.account.as_deref(), Some("viewer"));
        assert!(!authority.ready);
        assert!(authority.policy.is_none());
        assert!(
            reopened
                .check_snapshot_generation(Some(authority.generation))
                .await
                .is_ok()
        );
        reopened
            .check_snapshot_generation(Some(authority.generation))
            .await
            .unwrap();
        assert!(matches!(
            reopened
                .read_query(None, query, Some("Mail"), &Default::default())
                .await
                .unwrap(),
            ReadResult::Hit { data: restored } if restored == data
        ));
    });
}

#[test]
fn first_account_binding_preserves_unproven_generation_and_authored_queue() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let thread = EntityKey("GraphqlSoupEmailThread:offline-thread".into());
        let content = Record {
            fields: [("name".into(), CacheValue::String("offline subject".into()))].into(),
        };
        storage
            .put_batch(vec![(thread.clone(), content.clone())])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let initial = engine.current_authority("profile").await.unwrap();
        let storage_generation = engine.current_storage_generation().await.unwrap();
        engine.begin_optimistic_write(None, BeginOptimisticWrite {
            task_dependency_recipe: None,
            uuid: "00000000-0000-4000-8000-000000000001",
            query: "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { id } } }",
            operation_name: Some("Save"),
            variables: json!({"input":{"bodyText":"authored reply","threadId":"local-thread"}}).as_object().unwrap(),
            data: &json!({}),
            link_patches: &[],
            revalidations: &[],
            identity_bindings: &[],
            client_metadata: Some(&json!({"journal":"keep"})),
            created_at_ms: 1,
        }).await.unwrap();
        let queued = engine.storage().load_mutation_queue().await.unwrap();
        engine
            .write_query(
                None,
                "{ user { id } }",
                None,
                &Default::default(),
                &json!({"user":{"id":"viewer"}}),
                Some("viewer"),
            )
            .await
            .unwrap();
        let bound = engine.current_authority("profile").await.unwrap();
        assert_eq!(bound.generation, initial.generation);
        assert_eq!(bound.account.as_deref(), Some("viewer"));
        assert!(bound.policy.is_none());
        assert!(!bound.ready);
        let mut reopened = Engine::new(engine.into_storage());
        assert_eq!(reopened.current_authority("profile").await.unwrap(), bound);
        assert_eq!(
            reopened.current_storage_generation().await.unwrap(),
            storage_generation
        );
        assert_eq!(
            reopened.storage().get_batch(&[thread]).await.unwrap(),
            vec![Some(content)]
        );
        assert_eq!(
            reopened.storage().load_mutation_queue().await.unwrap(),
            queued
        );
        assert!(
            reopened
                .snapshot_is_current(Some(initial.generation))
                .await
                .unwrap()
        );
    });
}

#[test]
fn an_account_witness_cannot_be_confused_with_the_physical_cache_profile() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let initial = engine.current_authority("anonymous-profile").await.unwrap();
        let allowed = engine
            .transition_authority(
                "anonymous-profile",
                initial.generation,
                "team:allowed".into(),
                &[],
            )
            .await
            .unwrap()
            .authority;
        engine.bind_identity("first-account").await.unwrap();
        assert!(
            engine
                .check_snapshot_generation(Some(allowed.generation))
                .await
                .is_err()
        );
        let bound = engine.current_authority("anonymous-profile").await.unwrap();
        assert_eq!(bound.account.as_deref(), Some("first-account"));
        assert_ne!(bound.generation, allowed.generation);
        assert!(!bound.ready);
        assert!(bound.policy.is_none());
        assert!(engine.current_authority("first-account").await.is_err());
        let accepted = engine
            .transition_authority(
                "anonymous-profile",
                bound.generation,
                "team:allowed".into(),
                &[],
            )
            .await
            .unwrap()
            .authority;
        let mut reopened = Engine::new(engine.into_storage());
        assert!(
            reopened
                .check_snapshot_generation(Some(accepted.generation))
                .await
                .is_ok()
        );
        assert_eq!(
            reopened
                .current_authority("anonymous-profile")
                .await
                .unwrap(),
            accepted
        );
        reopened
            .check_snapshot_generation(Some(accepted.generation))
            .await
            .unwrap();
        reopened
            .write_query(
                None,
                "query { user { id } }",
                None,
                &Default::default(),
                &json!({"user":{"id":"second-account"}}),
                Some("second-account"),
            )
            .await
            .unwrap();
        assert!(
            reopened
                .check_snapshot_generation(Some(accepted.generation))
                .await
                .is_err()
        );
        let other = reopened
            .current_authority("anonymous-profile")
            .await
            .unwrap();
        assert_eq!(other.account.as_deref(), Some("second-account"));
        assert_ne!(other.generation, accepted.generation);
        assert!(!other.ready);
    });
}

#[test]
fn binding_an_account_preserves_unfinished_retirement() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let initial = engine.current_authority("profile").await.unwrap();
        let interrupted = engine
            .begin_authority_transition("profile", initial.generation, "team:denied".into(), true)
            .await
            .unwrap();
        assert!(!interrupted.ready);
        engine.bind_identity("viewer").await.unwrap();
        let mut reopened = Engine::new(engine.into_storage());
        let bound = reopened.current_authority("profile").await.unwrap();
        assert_eq!(bound.account.as_deref(), Some("viewer"));
        assert_ne!(bound.generation, interrupted.generation);
        assert_eq!(bound.policy.as_deref(), Some("team:denied"));
        assert!(!bound.ready);
        let resumed = reopened
            .begin_authority_transition("profile", bound.generation, "team:allowed".into(), false)
            .await
            .unwrap();
        assert!(!resumed.ready);
        assert!(
            reopened
                .check_snapshot_generation(Some(resumed.generation))
                .await
                .is_ok()
        );
        reopened
            .complete_authority_transition(resumed)
            .await
            .unwrap();
    });
}

#[test]
fn permission_transport_matches_the_generated_contract() {
    let expected: serde_json::Value = serde_json::from_str(include_str!("schema.json")).unwrap();
    assert_eq!(transport_schemas(), expected);
}

#[test]
fn retired_calendar_create_can_select_its_committed_identity_without_response_content() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.bind_identity("viewer").await.unwrap();
        let initial = engine.current_authority("viewer").await.unwrap();
        let allowed = engine
            .transition_authority("viewer", initial.generation, "allowed".into(), &[])
            .await
            .unwrap();
        let query = "mutation Create($input: CreateCalendarEventInput!) { createCalendarEvent(input: $input) { event { __typename id title } } }";
        let uuid = "00000000-0000-4000-8000-000000000101";
        let local = EntityKey::entity("GraphqlCalendarEvent", &[uuid]);
        let canonical = "00000000-0000-4000-8000-000000000102";
        let variables = json!({"input": {"idempotencyKey": uuid, "title": "Authored title"}});
        let response = json!({"createCalendarEvent": {"event": {
            "__typename": "GraphqlCalendarEvent", "id": canonical, "title": "Retired content"
        }}});
        let binding = IdentityBinding {
            local_key: local.clone(),
            delete_record: false,
            response_path: vec!["createCalendarEvent".into(), "event".into()],
            reference_fields: vec![],
            revalidation_variables: vec![],
        };
        let queued = engine
            .enqueue_optimistic_mutation_in_generation(
                None,
                BeginOptimisticWrite {
                    task_dependency_recipe: None,
                    client_metadata: None,
                    identity_bindings: &[binding],
                    uuid,
                    query,
                    operation_name: Some("Create"),
                    variables: variables.as_object().unwrap(),
                    data: &json!({"createCalendarEvent": {"event": {
                        "__typename": "GraphqlCalendarEvent", "id": uuid, "title": "Authored title"
                    }}}),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
                MutationClaimRequest {
                    owner: "client".into(),
                    now_ms: 2,
                    lease_expires_at_ms: 100,
                },
                OptimisticEffects::default(),
                Some(allowed.authority.generation),
            )
            .await
            .unwrap();
        let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
            panic!("create must be claimed")
        };
        engine
            .transition_authority("viewer", allowed.authority.generation, "denied".into(), &[])
            .await
            .unwrap();
        let result = engine
            .commit_optimistic_write_in_generation(
                queued.transaction_id,
                MutationClaimToken {
                    owner: "client".into(),
                    generation: claimed.lease_generation,
                },
                NetworkWrite {
                    query,
                    operation_name: Some("Create"),
                    variables: variables.as_object().unwrap(),
                    data: &response,
                    identity: Some("viewer"),
                },
                vec![],
                Some(allowed.authority.generation),
            )
            .await
            .unwrap();
        assert!(matches!(result, CommitOptimisticWriteResult::Committed(_)));
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        let selection = RecordSelection::parse(
            crate::meta::bundled_schema_ref(),
            "fragment CalendarEventIdentity on GraphqlCalendarEvent { __typename id }",
            "CalendarEventIdentity",
        )
        .unwrap();
        let selected = engine
            .read_records_by_keys(&selection, &[local])
            .await
            .unwrap();
        assert_eq!(selected.value.len(), 1);
        assert_eq!(
            selected.value[0].record,
            json!({"__typename": "GraphqlCalendarEvent", "id": canonical})
        );
        assert!(!selected.value[0].identity.pending);
        assert_eq!(
            selected.value[0].identity.mutation_uuid.as_deref(),
            Some(uuid)
        );
        let canonical_record = engine
            .storage()
            .get_batch(&[EntityKey::entity("GraphqlCalendarEvent", &[canonical])])
            .await
            .unwrap();
        assert!(
            !canonical_record[0]
                .as_ref()
                .unwrap()
                .fields
                .contains_key("title")
        );
    });
}

#[test]
fn authority_is_cached_until_the_single_owner_resets() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let current = engine.current_authority("profile").await.unwrap();
        assert_eq!(engine.authority.get(), Some(&Some(current.clone())));
        // Simulate an externally replaced store: cached reads keep the owner's
        // view until the same reset notification that invalidates identity.
        engine.storage.clear().await.unwrap();
        assert_eq!(engine.stored_authority().await.unwrap(), Some(current));
        engine.external_reset().unwrap();
        assert_eq!(engine.stored_authority().await.unwrap(), None);
        let replacement = engine.current_authority("profile").await.unwrap();
        engine.clear().await.unwrap();
        assert_eq!(engine.stored_authority().await.unwrap(), None);
        assert_ne!(
            engine
                .current_authority("profile")
                .await
                .unwrap()
                .generation,
            replacement.generation
        );
    });
}
