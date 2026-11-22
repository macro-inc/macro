use super::*;
use cache_core::predicate::ProjectionMutation;
use cache_core::queue::{
    MutationRequest, NewQueuedMutation, PersistedOptimisticLayer, StoredMutation,
    encode_optimistic_source,
};
use cache_core::store::Storage;
use cache_turso::TursoFileDatabase;
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, OptimisticProjectionMutation, OptimisticProjectionState,
    PendingOptimisticProjection, Profile, Token,
};
use serde_json::json;
use std::time::Instant;

fn projection(key: &EntityKey<'_>) -> IndexDocument {
    IndexDocument {
        record_key: RecordKey::new(key.to_string()).unwrap(),
        profile: Profile::new(Token::new("retirement-benchmark").unwrap()),
        partition: Token::new("items").unwrap(),
        exact_facts: vec![ExactFact {
            attribute: Token::new("owner").unwrap(),
            value: ExactValue::utf8("viewer").unwrap(),
        }],
        integer_facts: vec![],
        sort_facts: vec![],
    }
}
fn row(kind: &str, id: &str) -> Record {
    Record {
        fields: [
            ("__typename".into(), CacheValue::String(kind.into())),
            ("id".into(), CacheValue::String(id.into())),
            ("name".into(), CacheValue::String("copied snapshot".into())),
            (
                "displayName".into(),
                CacheValue::String("copied snapshot".into()),
            ),
        ]
        .into(),
    }
}

#[test]
#[ignore = "file-backed full retirement measurement; run explicitly"]
fn measure_full_permission_retirement_with_properties_and_pending_commands() {
    pollster::block_on(async {
        for (queue_size, fanout) in [(0, 1), (100, 1), (1000, 1), (100, 4)] {
            let directory = tempfile::tempdir().unwrap();
            let database =
                TursoFileDatabase::new(directory.path().join("authority.turso")).unwrap();
            let mut storage = database.open("viewer").unwrap();
            let seeded = Instant::now();
            eprintln!(
                "permission phase=seed_start contacts=100000 fanout={fanout} pending={queue_size} path={}",
                directory.path().display()
            );
            for batch in 0..200 {
                let mut records = Vec::new();
                let mut projections = Vec::new();
                for offset in 0..500 {
                    let id = format!("{:06}", batch * 500 + offset);
                    let key = EntityKey::entity("GraphqlSoupCrmContact", &[&id]);
                    let properties = (0..fanout)
                        .map(|index| {
                            EntityKey::entity("GraphqlProperty", &[&format!("{id}-{index}")])
                        })
                        .collect::<Vec<_>>();
                    let mut contact = row("GraphqlSoupCrmContact", &id);
                    contact.fields.insert(
                        "properties".into(),
                        CacheValue::List(properties.iter().cloned().map(CacheValue::Ref).collect()),
                    );
                    records.push((key.clone(), contact));
                    projections.push(ProjectionMutation::Replace(projection(&key)));
                    for property in properties {
                        records.push((
                            property.clone(),
                            row("GraphqlProperty", property.id().unwrap()),
                        ));
                    }
                }
                storage
                    .put_batch_with_projections(records, projections)
                    .await
                    .unwrap();
            }
            eprintln!(
                "permission phase=base_seeded pending={queue_size} fanout={fanout} elapsed={:?}",
                seeded.elapsed()
            );
            let kept = EntityKey::entity("GraphqlSoupDocument", &["kept"]);
            let kept_property = EntityKey::entity("GraphqlProperty", &["kept-property"]);
            let mut kept_record = row("GraphqlSoupDocument", "kept");
            kept_record.fields.insert(
                "properties".into(),
                CacheValue::List(vec![CacheValue::Ref(kept_property.clone())]),
            );
            let kept_property_record = row("GraphqlProperty", "kept-property");
            let orphan = EntityKey::entity("GraphqlSoupCrmContact", &[""]);
            storage
                .put_batch_with_projections(
                    vec![
                        (kept.clone(), kept_record.clone()),
                        (kept_property.clone(), kept_property_record.clone()),
                    ],
                    vec![
                        ProjectionMutation::Replace(projection(&kept)),
                        ProjectionMutation::Replace(projection(&kept_property)),
                        ProjectionMutation::Replace(projection(&orphan)),
                    ],
                )
                .await
                .unwrap();
            // Use a schema-valid request and normalized source, then persist
            // actual shadow rows so retirement deletes positive rows.
            let query = r#"
                mutation Rename($inputs: [RenameEntityInput!]!) {
                    renameEntities(inputs: $inputs) {
                        results {
                            __typename
                            ... on GraphqlMutationSuccess {
                                effects {
                                    __typename
                                    ... on SoupUpdated {
                                        item { __typename id displayName }
                                    }
                                }
                            }
                        }
                    }
                }
            "#;
            let document = crate::parsed_document::parsed_document(query).unwrap();
            let operation = document.operation(Some("Rename")).unwrap();
            let mut queued_keys = Vec::new();
            let mut queued_base = Vec::new();
            let queue_seeded = Instant::now();
            for index in 0..queue_size {
                let (kind, entity_type) = if index % 2 == 0 {
                    ("GraphqlSoupCrmContact", "CRM_CONTACT")
                } else {
                    ("GraphqlSoupDocument", "DOCUMENT")
                };
                let id = format!("queued-{index}");
                let key = EntityKey::entity(kind, &[&id]);
                let variables = json!({"inputs":[{"entity":{"type":entity_type,"id":id},"displayName":"authored rename"}]});
                let data = json!({"renameEntities":{"results":[{"__typename":"GraphqlMutationSuccess","effects":[{"__typename":"SoupUpdated","item":{"__typename":kind,"id":id,"displayName":"authored rename"}}]}]}});
                let normalized_updates = cache_core::normalize::normalize(
                    cache_core::meta::bundled_schema_ref(),
                    operation,
                    variables.as_object().unwrap(),
                    &data,
                )
                .unwrap();
                assert!(normalized_updates.contains_key(&key));
                let source = OptimisticSource {
                    task_dependency_recipe: None,
                    client_metadata: Some(json!({"revision":index})),
                    identity_bindings: vec![cache_core::identity::IdentityBinding {
                        local_key: key.clone(),
                        response_path: vec![
                            "renameEntities".into(),
                            "results".into(),
                            "0".into(),
                            "effects".into(),
                            "0".into(),
                            "item".into(),
                        ],
                        delete_record: false,
                        reference_fields: vec![],
                        revalidation_variables: vec![],
                    }],
                    mutation_data: data,
                    link_patches: vec![],
                    revalidations: vec![],
                    projection_mutations: vec![OptimisticProjectionMutation::Replace(projection(
                        &key,
                    ))],
                    uncertain_calendar_event_keys: vec![],
                };
                let mut mutation = StoredMutation::new(
                    MutationRequest {
                        query: query.into(),
                        operation_name: Some("Rename".into()),
                        variables_json: variables.to_string(),
                        identity: Some("viewer".into()),
                    },
                    1,
                );
                mutation.attempt_count = 2;
                mutation.server_failure_count = 1;
                mutation.lease_owner = Some("runner".into());
                mutation.lease_generation = 3;
                mutation.lease_expires_at_ms = Some(100);
                mutation.next_attempt_at_ms = Some(50);
                mutation.last_error = Some("retry".into());
                storage
                    .enqueue_mutation_with_shadow(
                        NewQueuedMutation {
                            uuid: Uuid::now_v7(),
                            mutation,
                            optimistic: PersistedOptimisticLayer {
                                optimistic_data_json: encode_optimistic_source(&source),
                                normalized_updates,
                            },
                        },
                        vec![PendingOptimisticProjection {
                            state: OptimisticProjectionState::Complete(projection(&key)),
                            uncertainty: Default::default(),
                        }],
                    )
                    .await
                    .unwrap();
                queued_keys.push(key.clone());
                queued_base.push((key, row(kind, &id)));
            }
            storage.put_batch(queued_base.clone()).await.unwrap();
            let queued_projection_keys = queued_keys
                .iter()
                .map(|key| RecordKey::new(key.to_string()).unwrap())
                .collect::<Vec<_>>();
            let shadows_before = storage
                .load_optimistic_projections(&queued_projection_keys)
                .await
                .unwrap();
            assert_eq!(shadows_before.len(), queue_size);
            assert!(shadows_before.iter().all(Option::is_some));
            for shadow in shadows_before.iter().flatten() {
                let OptimisticProjectionState::Complete(document) = &shadow.state else {
                    panic!("fixture needs complete shadow rows");
                };
                assert_eq!(document.exact_facts.len(), 1);
            }
            eprintln!(
                "permission phase=queue_seeded pending={queue_size} shadows={} fanout={fanout} elapsed={:?} total_seed={:?}",
                shadows_before.len(),
                queue_seeded.elapsed(),
                seeded.elapsed()
            );
            let before = storage.load_mutation_queue().await.unwrap();
            let mut engine = Engine::new(storage);
            let initial = engine.current_authority("profile").await.unwrap();
            eprintln!("permission phase=transition_start pending={queue_size} fanout={fanout}");
            let started = Instant::now();
            let completed = transition_crm_authority(
                &mut engine,
                "profile",
                initial.generation,
                "team:denied".into(),
            )
            .await
            .unwrap();
            let elapsed = started.elapsed();
            eprintln!(
                "permission phase=transition_complete pending={queue_size} fanout={fanout} elapsed={elapsed:?}"
            );
            let verified = Instant::now();
            assert!(completed.authority.ready);
            assert!(
                engine
                    .storage()
                    .record_keys("GraphqlSoupCrmContact", None, 500)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                engine
                    .storage()
                    .record_keys("GraphqlProperty", None, 500)
                    .await
                    .unwrap(),
                vec![kept_property.clone()]
            );
            assert!(
                engine
                    .storage()
                    .projection_keys("GraphqlSoupCrmContact", None, 500)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                engine
                    .storage()
                    .get_batch(&[kept.clone(), kept_property.clone()])
                    .await
                    .unwrap(),
                vec![Some(kept_record), Some(kept_property_record)]
            );
            let kept_projection_keys = [kept, kept_property]
                .iter()
                .map(|key| RecordKey::new(key.to_string()).unwrap())
                .collect::<Vec<_>>();
            assert!(
                engine
                    .storage()
                    .load_projection_states(&kept_projection_keys)
                    .await
                    .unwrap()
                    .iter()
                    .all(Option::is_some)
            );
            let after = engine.storage().load_mutation_queue().await.unwrap();
            assert_eq!(before.len(), after.len());
            let shadows_after = engine
                .storage()
                .load_optimistic_projections(&queued_projection_keys)
                .await
                .unwrap();
            let queued_base_after = engine.storage().get_batch(&queued_keys).await.unwrap();
            for (index, (before, after)) in before.iter().zip(&after).enumerate() {
                assert_eq!(before.mutation, after.mutation);
                assert_eq!(before.uuid, after.uuid);
                assert_eq!(before.id, after.id);
                assert_eq!(before.superseded, after.superseded);
                let original =
                    decode_optimistic_source(&before.optimistic.optimistic_data_json).unwrap();
                let retired =
                    decode_optimistic_source(&after.optimistic.optimistic_data_json).unwrap();
                assert_eq!(original.client_metadata, retired.client_metadata);
                assert_eq!(original.identity_bindings, retired.identity_bindings);
                if index % 2 == 1 {
                    assert_eq!(
                        before.optimistic.optimistic_data_json,
                        after.optimistic.optimistic_data_json
                    );
                    // Directly seeded layers omit the lifecycle marker that
                    // the engine derives from an explicit non-delete binding.
                    let mut expected = before.optimistic.normalized_updates.clone();
                    expected
                        .get_mut(&queued_keys[index])
                        .unwrap()
                        .fields
                        .insert(
                            cache_core::identity::DELETED_FIELD.into(),
                            CacheValue::Bool(false),
                        );
                    assert_eq!(expected, after.optimistic.normalized_updates);
                    assert_eq!(shadows_before[index], shadows_after[index]);
                    assert_eq!(queued_base_after[index], Some(queued_base[index].1.clone()));
                } else {
                    assert_eq!(retired.mutation_data, json!({}));
                    assert!(after.optimistic.normalized_updates.is_empty());
                    assert!(shadows_after[index].is_none());
                    assert!(queued_base_after[index].is_none());
                }
            }
            let started = std::time::Instant::now();
            let unchanged = transition_crm_authority(
                &mut engine,
                "profile",
                completed.authority.generation,
                "team:denied".into(),
            )
            .await
            .unwrap();
            let unchanged_elapsed = started.elapsed();
            assert!(!unchanged.changed);
            engine.into_storage().try_close().unwrap();
            let mut reopened = Engine::new(database.open("viewer").unwrap());
            assert_eq!(
                reopened.current_authority("profile").await.unwrap(),
                completed.authority
            );
            assert_eq!(
                reopened.storage().load_mutation_queue().await.unwrap(),
                after
            );
            reopened.into_storage().try_close().unwrap();
            eprintln!(
                "permission retirement contacts=100000 properties={} pending={queue_size} shadows={queue_size}: {elapsed:?}; unchanged policy {unchanged_elapsed:?}; verification {:?}",
                100_000 * fanout,
                verified.elapsed()
            );
        }
    });
}
