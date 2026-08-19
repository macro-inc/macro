use cache_core::{
    engine::{BeginOptimisticWrite, Engine},
    predicate::{PredicateQueryResult, ProjectionIncompleteKind, ProjectionMutation},
    queue::{MutationClaimRequest, MutationClaimToken, MutationId},
    store::InMemoryStorage,
    value::{EntityKey, Record},
};
use predicate_index::{
    ExactAttributePatch, ExactFact, ExactValue, IndexDocument, IndexQuery, IntegerAttributePatch,
    IntegerFact, OptimisticProjectionMutation, PartitionPredicate, PredicateExpr, Profile,
    RecordKey, SortDirection, Token, ValidatedIndexQuery,
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

async fn begin_with_projection(
    engine: &mut Engine<InMemoryStorage>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
) -> MutationId {
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
        .unwrap()
        .0
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
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-1"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![record_key()])
        );

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
        begin_with_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(projection("owner-2"))],
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
            PredicateQueryResult::Optimistic(vec![record_key()])
        );

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
            PredicateQueryResult::Optimistic(vec![record_key()])
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
