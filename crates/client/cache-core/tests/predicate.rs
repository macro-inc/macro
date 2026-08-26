use cache_core::{
    engine::{BeginOptimisticWrite, Engine, EngineError},
    predicate::{
        PredicateQueryResult, ProjectionIncompleteKind, ProjectionMutation,
        ProjectionMutationLayer, ProjectionState, compose_effective_optimistic_projection,
        compose_pending_optimistic_projection,
    },
    queue::{MutationClaimRequest, MutationClaimToken, MutationId},
    store::{InMemoryStorage, Storage},
    value::{CacheValue, EntityKey, Record},
};
use predicate_index::{
    EffectiveOptimisticProjection, ExactAttributePatch, ExactFact, ExactValue, IndexDocument,
    IndexQuery, IntegerAttributePatch, IntegerFact, MAX_OPTIMISTIC_RECORDS_PER_QUERY,
    MAX_QUERY_LIMIT, OptimisticProjectionMutation, OptimisticProjectionState,
    OptimisticUncertainty, PartitionPredicate, PredicateExpr, Profile, RecordKey, SortDirection,
    Token, ValidatedIndexQuery,
};

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}

fn profile() -> Profile {
    Profile::new(token("soup-flat-v1"))
}

fn record_key() -> RecordKey {
    RecordKey::new("GraphqlSoupDocument:doc-1").unwrap()
}

fn projection(owner: &str) -> IndexDocument {
    projection_for(record_key(), owner, 10)
}

fn projection_for(record_key: RecordKey, owner: &str, updated_at: i64) -> IndexDocument {
    IndexDocument {
        record_key,
        profile: profile(),
        partition: token("document"),
        exact_facts: vec![ExactFact {
            attribute: token("owner"),
            value: ExactValue::utf8(owner).unwrap(),
        }],
        integer_facts: vec![],
        sort_facts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: updated_at,
        }],
    }
}

fn query(owner: &str) -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: profile(),
        partitions: vec![PartitionPredicate {
            partition: token("document"),
            predicate: PredicateExpr::Exact {
                attribute: token("owner"),
                value: ExactValue::utf8(owner).unwrap(),
            },
        }],
        sort_attribute: token("updated-at"),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 20,
    })
    .unwrap()
}

const OPTIMISTIC_MUTATION: &str = r#"
    mutation SetEntityProperty($input: SetEntityPropertyInput!) {
      setEntityProperty(input: $input) {
        id
        displayName
        value {
          __typename
          ... on GraphqlStringPropertyValue { stringValue: value }
        }
      }
    }
"#;

fn optimistic_data() -> serde_json::Value {
    serde_json::json!({
        "setEntityProperty": {
            "id": "prop-1",
            "displayName": "Status",
            "value": {
                "__typename": "GraphqlStringPropertyValue",
                "stringValue": "doing"
            }
        }
    })
}

fn optimistic_variables() -> serde_json::Map<String, serde_json::Value> {
    let serde_json::Value::Object(variables) = serde_json::json!({
        "input": {
            "entityType": "DOCUMENT",
            "entityId": "doc-1",
            "propertyDefinitionId": "def-1",
            "value": { "string": "doing" }
        }
    }) else {
        unreachable!()
    };
    variables
}

async fn try_begin_with_projection(
    engine: &mut Engine<InMemoryStorage>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
) -> Result<MutationId, EngineError<std::convert::Infallible>> {
    engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                query: OPTIMISTIC_MUTATION,
                operation_name: Some("SetEntityProperty"),
                variables: &optimistic_variables(),
                data: &optimistic_data(),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
            },
            projection_mutations,
        )
        .await
        .map(|result| result.0)
}

async fn begin_with_projection(
    engine: &mut Engine<InMemoryStorage>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
) -> MutationId {
    try_begin_with_projection(engine, projection_mutations)
        .await
        .unwrap()
}

#[test]
fn replacement_removes_stale_facts_and_incomplete_states_fall_back() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entity_key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);
        engine
            .put_records_with_projections(
                None,
                vec![(entity_key.clone(), Record::default())],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        let observed = engine
            .query_predicate_index(&query("owner-1"))
            .await
            .unwrap();
        assert_eq!(observed.revision, engine.current_revision());
        assert_eq!(observed, PredicateQueryResult::Complete(vec![record_key()]));

        engine
            .put_records_with_projections(
                None,
                vec![(entity_key, Record::default())],
                vec![ProjectionMutation::Replace(projection("owner-2"))],
            )
            .await
            .unwrap();
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![])
        );

        for kind in [
            ProjectionIncompleteKind::Dirty,
            ProjectionIncompleteKind::Missing,
            ProjectionIncompleteKind::IncompatibleVersion,
        ] {
            engine
                .mark_projections_incomplete(vec![ProjectionMutation::MarkIncomplete {
                    record_key: record_key(),
                    profile: profile(),
                    partition: token("document"),
                    kind,
                }])
                .await
                .unwrap();
            assert_eq!(
                engine
                    .query_predicate_index(&query("owner-2"))
                    .await
                    .unwrap(),
                PredicateQueryResult::Incomplete
            );
            engine
                .put_records_with_projections(
                    None,
                    vec![],
                    vec![ProjectionMutation::Replace(projection("owner-2"))],
                )
                .await
                .unwrap();
        }

        for mutation in [
            OptimisticProjectionMutation::Patch {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                exact: vec![
                    ExactAttributePatch {
                        attribute: token("owner"),
                        values: vec![],
                    },
                    ExactAttributePatch {
                        attribute: token("owner"),
                        values: vec![],
                    },
                ],
                integers: vec![],
                sorts: vec![],
            },
            OptimisticProjectionMutation::Patch {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                exact: vec![],
                integers: vec![
                    IntegerAttributePatch {
                        attribute: token("updated-at"),
                        values: vec![],
                    },
                    IntegerAttributePatch {
                        attribute: token("updated-at"),
                        values: vec![],
                    },
                ],
                sorts: vec![],
            },
            OptimisticProjectionMutation::Patch {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                exact: vec![],
                integers: vec![],
                sorts: vec![
                    IntegerFact {
                        attribute: token("updated-at"),
                        value: 1,
                    },
                    IntegerFact {
                        attribute: token("updated-at"),
                        value: 2,
                    },
                ],
            },
        ] {
            assert!(matches!(
                try_begin_with_projection(&mut engine, vec![mutation]).await,
                Err(EngineError::InvalidOptimisticProjection(_))
            ));
        }

        let mut too_many_engine = Engine::new(InMemoryStorage::new());
        begin_with_projection(
            &mut too_many_engine,
            (0..=MAX_OPTIMISTIC_RECORDS_PER_QUERY)
                .map(|index| {
                    OptimisticProjectionMutation::Replace(projection_for(
                        RecordKey::new(format!("GraphqlSoupDocument:doc-{index}")).unwrap(),
                        "owner-1",
                        index as i64,
                    ))
                })
                .collect(),
        )
        .await;
        let PredicateQueryResult::Optimistic(keys) = too_many_engine
            .query_predicate_index(&query("owner-1"))
            .await
            .unwrap()
            .value
        else {
            panic!("durable shadows remove the per-query touched-key bound")
        };
        assert_eq!(keys.len(), 20);

        let mut expanded_limit_engine = Engine::new(InMemoryStorage::new());
        begin_with_projection(
            &mut expanded_limit_engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-1"))],
        )
        .await;
        let mut maximum_query = query("owner-1").as_query().clone();
        maximum_query.limit = MAX_QUERY_LIMIT;
        assert_eq!(
            expanded_limit_engine
                .query_predicate_index(&ValidatedIndexQuery::new(maximum_query).unwrap())
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![record_key()])
        );
    });
}

#[test]
fn direct_projection_writes_merge_partial_records_and_report_real_changes() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entity_key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);
        let mut base = Record::default();
        base.fields.insert(
            "__typename".into(),
            CacheValue::String("GraphqlSoupDocument".into()),
        );
        base.fields
            .insert("name".into(), CacheValue::String("Document".into()));
        engine
            .put_records_with_projections(
                None,
                vec![(entity_key.clone(), base)],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();

        let mut partial = Record::default();
        partial
            .fields
            .insert("name".into(), CacheValue::String("Document".into()));
        let result = engine
            .put_records_with_projections(
                None,
                vec![(entity_key.clone(), partial)],
                vec![ProjectionMutation::Replace(projection("owner-2"))],
            )
            .await
            .unwrap();
        assert!(result.changed.is_empty());
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-2"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![record_key()])
        );
        let stored = engine
            .storage()
            .get_batch(&[entity_key])
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();
        assert_eq!(
            stored.fields.get("__typename"),
            Some(&CacheValue::String("GraphqlSoupDocument".into()))
        );
    });
}

#[test]
fn optimistic_projection_layers_are_queryable_offline_and_survive_restart() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entity_key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);
        engine
            .put_records_with_projections(
                None,
                vec![(entity_key, Record::default())],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        let transaction = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-2"))],
        )
        .await;
        let shadow = engine
            .storage()
            .load_optimistic_projections(&[record_key()])
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();
        assert_eq!(shadow.owner, transaction);
        assert!(matches!(
            shadow.state,
            OptimisticProjectionState::Complete(_)
        ));
        let queue_loads = engine.storage().mutation_queue_load_count();

        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![])
        );
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-2"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![record_key()])
        );
        assert_eq!(engine.storage().mutation_queue_load_count(), queue_loads);

        let storage = engine.into_storage();
        let mut reopened = Engine::new(storage);
        assert_eq!(
            reopened
                .query_predicate_index(&query("owner-2"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![record_key()])
        );
    });
}

#[test]
fn optimistic_fact_patches_update_membership_and_sort_facts() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let second_key = RecordKey::new("GraphqlSoupDocument:doc-2").unwrap();
        engine
            .put_records_with_projections(
                None,
                vec![
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["doc-1"]),
                        Record::default(),
                    ),
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["doc-2"]),
                        Record::default(),
                    ),
                ],
                vec![
                    ProjectionMutation::Replace(projection("owner-1")),
                    ProjectionMutation::Replace(projection_for(second_key.clone(), "owner-2", 15)),
                ],
            )
            .await
            .unwrap();
        begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Patch {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                exact: vec![ExactAttributePatch {
                    attribute: token("owner"),
                    values: vec![ExactValue::utf8("owner-2").unwrap()],
                }],
                integers: vec![IntegerAttributePatch {
                    attribute: token("updated-at"),
                    values: vec![20],
                }],
                sorts: vec![IntegerFact {
                    attribute: token("updated-at"),
                    value: 20,
                }],
            }],
        )
        .await;

        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![])
        );
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-2"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![record_key(), second_key])
        );
    });
}

#[test]
fn optimistic_profile_change_suppresses_old_authority_and_is_reported_optimistic() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey::entity("GraphqlSoupDocument", &["doc-1"]),
                    Record::default(),
                )],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        let mut moved = projection("owner-1");
        moved.profile = Profile::new(token("another-profile"));
        begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(moved)],
        )
        .await;

        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![])
        );
    });
}

#[test]
fn optimistic_projection_rolls_back_and_settles_to_authoritative_facts() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entity_key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);
        engine
            .put_records_with_projections(
                None,
                vec![(entity_key, Record::default())],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        let transaction = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-2"))],
        )
        .await;
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".to_owned(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .rollback_optimistic_write(
                transaction,
                MutationClaimToken {
                    owner: "runner".to_owned(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![record_key()])
        );

        let transaction = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-2"))],
        )
        .await;
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".to_owned(),
                now_ms: 101,
                lease_expires_at_ms: 200,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .commit_optimistic_write_with_projections(
                transaction,
                MutationClaimToken {
                    owner: "runner".to_owned(),
                    generation: claim.lease_generation,
                },
                OPTIMISTIC_MUTATION,
                Some("SetEntityProperty"),
                &optimistic_variables(),
                &optimistic_data(),
                vec![ProjectionMutation::Replace(projection("owner-3"))],
            )
            .await
            .unwrap();
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-3"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![record_key()])
        );
    });
}

#[test]
fn rollback_recomposes_later_owned_shadow_without_discarded_facts() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey::entity("GraphqlSoupDocument", &["doc-1"]),
                    Record::default(),
                )],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        let first = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-2"))],
        )
        .await;
        let second = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Patch {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                exact: vec![],
                integers: vec![],
                sorts: vec![IntegerFact {
                    attribute: token("updated-at"),
                    value: 99,
                }],
            }],
        )
        .await;
        let claimed = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".to_owned(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .rollback_optimistic_write(
                first,
                MutationClaimToken {
                    owner: "runner".to_owned(),
                    generation: claimed.lease_generation,
                },
            )
            .await
            .unwrap();

        let shadow = engine
            .storage()
            .load_optimistic_projections(&[record_key()])
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();
        assert_eq!(shadow.owner, second);
        let OptimisticProjectionState::Complete(document) = shadow.state else {
            panic!("later patch should remain complete over authority")
        };
        assert!(document.exact_facts.iter().any(|fact| {
            fact.attribute == token("owner") && fact.value == ExactValue::utf8("owner-1").unwrap()
        }));
        assert_eq!(document.sort_facts[0].value, 99);
    });
}

#[test]
fn commit_recomposes_later_patch_against_anticipated_authority() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey::entity("GraphqlSoupDocument", &["doc-1"]),
                    Record::default(),
                )],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        let first = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-2"))],
        )
        .await;
        let second = begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Patch {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                exact: vec![],
                integers: vec![],
                sorts: vec![IntegerFact {
                    attribute: token("updated-at"),
                    value: 99,
                }],
            }],
        )
        .await;
        let claimed = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".to_owned(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .commit_optimistic_write_with_projections(
                first,
                MutationClaimToken {
                    owner: "runner".to_owned(),
                    generation: claimed.lease_generation,
                },
                OPTIMISTIC_MUTATION,
                Some("SetEntityProperty"),
                &optimistic_variables(),
                &optimistic_data(),
                vec![ProjectionMutation::Replace(projection("owner-3"))],
            )
            .await
            .unwrap();

        let shadow = engine
            .storage()
            .load_optimistic_projections(&[record_key()])
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();
        assert_eq!(shadow.owner, second);
        let OptimisticProjectionState::Complete(document) = shadow.state else {
            panic!("later patch should remain complete over committed authority")
        };
        assert!(document.exact_facts.iter().any(|fact| {
            fact.attribute == token("owner") && fact.value == ExactValue::utf8("owner-3").unwrap()
        }));
        assert_eq!(document.sort_facts[0].value, 99);
    });
}

#[test]
fn optimistic_deletion_overfetches_authoritative_replacement_candidates() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let first = RecordKey::new("GraphqlSoupDocument:doc-1").unwrap();
        let second = RecordKey::new("GraphqlSoupDocument:doc-2").unwrap();
        engine
            .put_records_with_projections(
                None,
                vec![
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["doc-1"]),
                        Record::default(),
                    ),
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["doc-2"]),
                        Record::default(),
                    ),
                ],
                vec![
                    ProjectionMutation::Replace(projection_for(first.clone(), "owner-1", 30)),
                    ProjectionMutation::Replace(projection_for(second.clone(), "owner-1", 20)),
                ],
            )
            .await
            .unwrap();
        let mut one = query("owner-1").as_query().clone();
        one.limit = 1;
        let one = ValidatedIndexQuery::new(one).unwrap();
        assert_eq!(
            engine.query_predicate_index(&one).await.unwrap(),
            PredicateQueryResult::Complete(vec![first.clone()])
        );

        begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Delete {
                record_key: first,
                profile: profile(),
                partition: token("document"),
            }],
        )
        .await;
        assert_eq!(
            engine.query_predicate_index(&one).await.unwrap(),
            PredicateQueryResult::Optimistic(vec![second])
        );
    });
}

#[test]
fn optimistic_delete_and_query_scoped_uncertainty_are_composed() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entity_key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);
        engine
            .put_records_with_projections(
                None,
                vec![(entity_key, Record::default())],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Unknown {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                affected_attributes: vec![token("file-type")],
            }],
        )
        .await;
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![record_key()])
        );

        begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Unknown {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                affected_attributes: vec![token("updated-at")],
            }],
        )
        .await;
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Incomplete
        );

        let mut delete_engine = Engine::new(engine.into_storage());
        begin_with_projection(
            &mut delete_engine,
            vec![OptimisticProjectionMutation::Delete {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
            }],
        )
        .await;
        assert_eq!(
            delete_engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Optimistic(vec![])
        );
    });
}

#[test]
fn effective_composer_tracks_latest_owner_and_field_uncertainty() {
    let key = record_key();
    let authoritative = ProjectionState::Complete(projection("owner-1"));
    let unknown = OptimisticProjectionMutation::Unknown {
        record_key: key.clone(),
        profile: profile(),
        partition: token("document"),
        affected_attributes: vec![],
    };
    let patch = OptimisticProjectionMutation::Patch {
        record_key: key.clone(),
        profile: profile(),
        partition: token("document"),
        exact: vec![ExactAttributePatch {
            attribute: token("owner"),
            values: vec![ExactValue::utf8("owner-2").unwrap()],
        }],
        integers: vec![],
        sorts: vec![],
    };
    let result = compose_effective_optimistic_projection(
        &key,
        Some(&authoritative),
        &[
            ProjectionMutationLayer {
                owner: 10,
                mutations: std::slice::from_ref(&unknown),
            },
            ProjectionMutationLayer {
                owner: 20,
                mutations: std::slice::from_ref(&patch),
            },
        ],
    )
    .unwrap()
    .unwrap();

    assert_eq!(result.owner, 20);
    assert!(!result.uncertainty.affects(&token("owner")));
    assert!(result.uncertainty.affects(&token("updated-at")));
    let OptimisticProjectionState::Complete(document) = result.state else {
        panic!("expected complete effective facts")
    };
    assert!(document.exact_facts.iter().any(|fact| {
        fact.attribute == token("owner") && fact.value == ExactValue::utf8("owner-2").unwrap()
    }));
}

#[test]
fn effective_composer_handles_create_delete_patch_and_replacement() {
    let key = record_key();
    let delete = OptimisticProjectionMutation::Delete {
        record_key: key.clone(),
        profile: profile(),
        partition: token("document"),
    };
    let patch = OptimisticProjectionMutation::Patch {
        record_key: key.clone(),
        profile: profile(),
        partition: token("document"),
        exact: vec![],
        integers: vec![],
        sorts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: 99,
        }],
    };
    let replacement = OptimisticProjectionMutation::Replace(projection("owner-3"));

    let incomplete = compose_effective_optimistic_projection(
        &key,
        None,
        &[
            ProjectionMutationLayer {
                owner: 1,
                mutations: std::slice::from_ref(&delete),
            },
            ProjectionMutationLayer {
                owner: 2,
                mutations: std::slice::from_ref(&patch),
            },
        ],
    )
    .unwrap()
    .unwrap();
    assert!(matches!(
        incomplete.state,
        OptimisticProjectionState::Incomplete {
            kind: ProjectionIncompleteKind::Missing,
            ..
        }
    ));

    let complete = compose_effective_optimistic_projection(
        &key,
        None,
        &[
            ProjectionMutationLayer {
                owner: 1,
                mutations: &[delete],
            },
            ProjectionMutationLayer {
                owner: 2,
                mutations: &[patch],
            },
            ProjectionMutationLayer {
                owner: 3,
                mutations: &[replacement],
            },
        ],
    )
    .unwrap()
    .unwrap();
    assert_eq!(complete.owner, 3);
    assert!(complete.uncertainty.is_empty());
    assert!(matches!(
        complete.state,
        OptimisticProjectionState::Complete(_)
    ));
}

#[test]
fn pending_composer_reuses_current_effective_shadow_deterministically() {
    let key = record_key();
    let current = EffectiveOptimisticProjection {
        owner: 7,
        state: OptimisticProjectionState::Complete(projection("owner-1")),
        uncertainty: OptimisticUncertainty::Attributes([token("file-type")].into()),
    };
    let patch = OptimisticProjectionMutation::Patch {
        record_key: key.clone(),
        profile: profile(),
        partition: token("document"),
        exact: vec![ExactAttributePatch {
            attribute: token("owner"),
            values: vec![
                ExactValue::utf8("owner-2").unwrap(),
                ExactValue::utf8("owner-2").unwrap(),
            ],
        }],
        integers: vec![],
        sorts: vec![],
    };

    let pending = compose_pending_optimistic_projection(&key, None, Some(&current), &[patch])
        .unwrap()
        .unwrap();
    let OptimisticProjectionState::Complete(document) = pending.state else {
        panic!("expected complete pending projection")
    };
    assert_eq!(document.exact_facts.len(), 1);
    assert!(pending.uncertainty.affects(&token("file-type")));
    assert!(!pending.uncertainty.affects(&token("owner")));
}

#[test]
fn composer_rejects_out_of_order_layers_and_ignores_disjoint_keys() {
    let key = record_key();
    let other = OptimisticProjectionMutation::Replace(projection_for(
        RecordKey::new("GraphqlSoupDocument:other").unwrap(),
        "owner-2",
        1,
    ));
    assert!(
        compose_effective_optimistic_projection(
            &key,
            Some(&ProjectionState::Complete(projection("owner-1"))),
            &[
                ProjectionMutationLayer {
                    owner: 2,
                    mutations: std::slice::from_ref(&other),
                },
                ProjectionMutationLayer {
                    owner: 1,
                    mutations: &[],
                },
            ],
        )
        .is_err()
    );
    assert_eq!(
        compose_effective_optimistic_projection(
            &key,
            Some(&ProjectionState::Complete(projection("owner-1"))),
            &[ProjectionMutationLayer {
                owner: 1,
                mutations: &[other],
            }],
        )
        .unwrap(),
        None
    );
}

#[test]
fn generated_incremental_shadow_composition_matches_full_queue_reconstruction() {
    let key = record_key();
    let authoritative = ProjectionState::Complete(projection("owner-1"));
    let cases = [
        OptimisticProjectionMutation::Replace(projection("owner-2")),
        OptimisticProjectionMutation::Patch {
            record_key: key.clone(),
            profile: profile(),
            partition: token("document"),
            exact: vec![ExactAttributePatch {
                attribute: token("owner"),
                values: vec![ExactValue::utf8("owner-3").unwrap()],
            }],
            integers: vec![],
            sorts: vec![],
        },
        OptimisticProjectionMutation::Delete {
            record_key: key.clone(),
            profile: profile(),
            partition: token("document"),
        },
        OptimisticProjectionMutation::Unknown {
            record_key: key.clone(),
            profile: profile(),
            partition: token("document"),
            affected_attributes: vec![token("updated-at")],
        },
    ];

    for encoded in 0..cases.len().pow(4) {
        let mut value = encoded;
        let mut current: Option<EffectiveOptimisticProjection> = None;
        let mut mutations = Vec::new();
        for owner in 1..=4 {
            let mutation = cases[value % cases.len()].clone();
            value /= cases.len();
            let pending = compose_pending_optimistic_projection(
                &key,
                Some(&authoritative),
                current.as_ref(),
                std::slice::from_ref(&mutation),
            )
            .unwrap()
            .unwrap();
            current = Some(EffectiveOptimisticProjection {
                owner,
                state: pending.state,
                uncertainty: pending.uncertainty,
            });
            mutations.push((owner, mutation));
        }
        let layers = mutations
            .iter()
            .map(|(owner, mutation)| ProjectionMutationLayer {
                owner: *owner,
                mutations: std::slice::from_ref(mutation),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            current,
            compose_effective_optimistic_projection(&key, Some(&authoritative), &layers).unwrap(),
            "generated sequence {encoded}"
        );
    }
}

#[test]
fn delete_and_clear_remove_projection_state() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entity_key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);
        engine
            .put_records_with_projections(
                None,
                vec![(entity_key.clone(), Record::default())],
                vec![ProjectionMutation::Replace(projection("owner-1"))],
            )
            .await
            .unwrap();
        engine
            .delete_keys_with_projections(&[entity_key], &[record_key()])
            .await
            .unwrap();
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![])
        );

        engine
            .mark_projections_incomplete(vec![ProjectionMutation::MarkIncomplete {
                record_key: record_key(),
                profile: profile(),
                partition: token("document"),
                kind: ProjectionIncompleteKind::Dirty,
            }])
            .await
            .unwrap();
        engine.clear().await.unwrap();
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![])
        );
    });
}
