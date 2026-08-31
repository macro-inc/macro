#![cfg(not(target_arch = "wasm32"))]

use cache_core::{
    engine::{BeginOptimisticWrite, Engine},
    predicate::{
        PredicateIndexStorage, PredicateQueryResult, ProjectionIncompleteKind, ProjectionMutation,
    },
    store::Storage,
    value::{EntityKey, Record},
};
use cache_turso::TursoStorage;
use predicate_index::{
    ExactAttributePatch, ExactFact, ExactValue, IndexDocument, IndexQuery, IntegerAttributePatch,
    IntegerFact, OptimisticProjectionMutation, PartitionPredicate, PredicateExpr, Profile,
    RangeBound, RecordKey, SortDirection, Token, ValidatedIndexQuery, evaluate_reference,
};

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}

fn profile() -> Profile {
    Profile::new(token("soup-flat-v1"))
}

fn document(key: &str, owner: &str, updated_at: i64, project: Option<&str>) -> IndexDocument {
    let mut exact_facts = vec![ExactFact {
        attribute: token("owner"),
        value: ExactValue::utf8(owner).unwrap(),
    }];
    if let Some(project) = project {
        exact_facts.push(ExactFact {
            attribute: token("project-id"),
            value: ExactValue::utf8(project).unwrap(),
        });
    }
    IndexDocument {
        record_key: RecordKey::new(key).unwrap(),
        profile: profile(),
        partition: token("document"),
        exact_facts,
        integer_facts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: updated_at,
        }],
        sort_facts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: updated_at,
        }],
    }
}

fn query() -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: profile(),
        partitions: vec![PartitionPredicate {
            partition: token("document"),
            predicate: PredicateExpr::And(
                Box::new(PredicateExpr::Exact {
                    attribute: token("owner"),
                    value: ExactValue::utf8("owner-1").unwrap(),
                }),
                Box::new(PredicateExpr::And(
                    Box::new(PredicateExpr::I64Range {
                        attribute: token("updated-at"),
                        lower: Some(RangeBound::Inclusive(10)),
                        upper: Some(RangeBound::Exclusive(30)),
                    }),
                    Box::new(PredicateExpr::Not(Box::new(PredicateExpr::Exact {
                        attribute: token("project-id"),
                        value: ExactValue::utf8("excluded").unwrap(),
                    }))),
                )),
            ),
        }],
        sort_attribute: token("updated-at"),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 20,
    })
    .unwrap()
}

async fn begin_optimistic_projection(
    engine: &mut Engine<TursoStorage>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
) {
    let data = serde_json::json!({
        "setEntityProperty": {
            "id": "prop-1",
            "displayName": "Status",
            "value": {
                "__typename": "GraphqlStringPropertyValue",
                "stringValue": "doing"
            }
        }
    });
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
    engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                query: r#"
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
                "#,
                operation_name: Some("SetEntityProperty"),
                variables: &variables,
                data: &data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
            },
            projection_mutations,
        )
        .await
        .unwrap();
}

#[test]
fn turso_matches_reference_and_lifecycle_is_exact() {
    pollster::block_on(async {
        let mut storage = TursoStorage::open_in_memory("predicate-conformance").unwrap();
        let documents = vec![
            document("GraphqlSoupDocument:1", "owner-1", 10, None),
            document("GraphqlSoupDocument:2", "owner-1", 20, Some("included")),
            document("GraphqlSoupDocument:3", "owner-1", 25, Some("excluded")),
            document("GraphqlSoupDocument:4", "owner-2", 20, None),
            document("GraphqlSoupDocument:5", "owner-1", 30, None),
        ];
        let entries = documents
            .iter()
            .map(|document| {
                let (typename, id) = document.record_key.as_str().split_once(':').unwrap();
                (EntityKey::entity(typename, &[id]), Record::default())
            })
            .collect();
        storage
            .put_batch_with_projections(
                entries,
                documents
                    .iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();

        let repeated_key = documents[0].record_key.clone();
        assert_eq!(
            storage
                .load_projection_states(&[repeated_key.clone(), repeated_key])
                .await
                .unwrap()
                .iter()
                .filter(|document| document.is_some())
                .count(),
            2
        );

        let query = query();
        let expected = evaluate_reference(&query, &documents)
            .into_iter()
            .map(|hit| hit.record_key)
            .collect::<Vec<_>>();
        assert_eq!(
            storage.query_predicate_index(&query).await.unwrap(),
            PredicateQueryResult::Complete(expected)
        );

        storage
            .put_batch_with_projections(
                vec![],
                vec![ProjectionMutation::Replace(document(
                    "GraphqlSoupDocument:2",
                    "owner-2",
                    20,
                    None,
                ))],
            )
            .await
            .unwrap();
        assert_eq!(
            storage.query_predicate_index(&query).await.unwrap(),
            PredicateQueryResult::Complete(vec![RecordKey::new("GraphqlSoupDocument:1").unwrap()])
        );

        storage
            .put_batch_with_projections(
                vec![],
                vec![ProjectionMutation::MarkIncomplete {
                    record_key: RecordKey::new("GraphqlSoupDocument:2").unwrap(),
                    profile: profile(),
                    partition: token("document"),
                    kind: ProjectionIncompleteKind::Dirty,
                }],
            )
            .await
            .unwrap();
        assert_eq!(
            storage.query_predicate_index(&query).await.unwrap(),
            PredicateQueryResult::Incomplete
        );

        storage
            .delete_batch_with_projections(
                &[EntityKey::entity("GraphqlSoupDocument", &["2"])],
                &[RecordKey::new("GraphqlSoupDocument:2").unwrap()],
            )
            .await
            .unwrap();
        assert_eq!(
            storage.query_predicate_index(&query).await.unwrap(),
            PredicateQueryResult::Complete(vec![RecordKey::new("GraphqlSoupDocument:1").unwrap()])
        );

        storage.clear().await.unwrap();
        assert_eq!(
            storage.query_predicate_index(&query).await.unwrap(),
            PredicateQueryResult::Complete(vec![])
        );
    });
}

#[test]
fn effective_sql_matches_reference_for_create_patch_delete_and_boolean_sorting() {
    pollster::block_on(async {
        let storage = TursoStorage::open_in_memory("predicate-effective-sql").unwrap();
        let mut engine = Engine::new(storage);
        let first = document("GraphqlSoupDocument:1", "owner-1", 10, None);
        let second = document("GraphqlSoupDocument:2", "owner-1", 20, Some("included"));
        let excluded = document("GraphqlSoupDocument:3", "owner-1", 25, Some("excluded"));
        engine
            .put_records_with_projections(
                None,
                vec![
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["1"]),
                        Record::default(),
                    ),
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["2"]),
                        Record::default(),
                    ),
                    (
                        EntityKey::entity("GraphqlSoupDocument", &["3"]),
                        Record::default(),
                    ),
                ],
                vec![
                    ProjectionMutation::Replace(first.clone()),
                    ProjectionMutation::Replace(second.clone()),
                    ProjectionMutation::Replace(excluded.clone()),
                ],
            )
            .await
            .unwrap();

        let created = document("GraphqlSoupDocument:4", "owner-1", 15, None);
        begin_optimistic_projection(
            &mut engine,
            vec![
                OptimisticProjectionMutation::Patch {
                    record_key: first.record_key.clone(),
                    profile: profile(),
                    partition: token("document"),
                    exact: vec![ExactAttributePatch {
                        attribute: token("project-id"),
                        values: vec![ExactValue::utf8("included").unwrap()],
                    }],
                    integers: vec![IntegerAttributePatch {
                        attribute: token("updated-at"),
                        values: vec![22],
                    }],
                    sorts: vec![IntegerFact {
                        attribute: token("updated-at"),
                        value: 22,
                    }],
                },
                OptimisticProjectionMutation::Delete {
                    record_key: second.record_key.clone(),
                    profile: profile(),
                    partition: token("document"),
                },
                OptimisticProjectionMutation::Replace(created.clone()),
            ],
        )
        .await;

        let mut patched = first;
        patched.exact_facts.push(ExactFact {
            attribute: token("project-id"),
            value: ExactValue::utf8("included").unwrap(),
        });
        patched.integer_facts[0].value = 22;
        patched.sort_facts[0].value = 22;
        patched.canonicalize();
        let expected = evaluate_reference(&query(), &[patched, excluded, created])
            .into_iter()
            .map(|hit| hit.record_key)
            .collect::<Vec<_>>();
        assert_eq!(
            engine.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Optimistic(expected)
        );
    });
}

#[test]
fn effective_sql_handles_uncertainty_and_shadow_suppression_exactly() {
    pollster::block_on(async {
        let storage = TursoStorage::open_in_memory("predicate-effective-uncertainty").unwrap();
        let mut engine = Engine::new(storage);
        let key = RecordKey::new("GraphqlSoupDocument:1").unwrap();
        engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey::entity("GraphqlSoupDocument", &["1"]),
                    Record::default(),
                )],
                vec![ProjectionMutation::Replace(document(
                    key.as_str(),
                    "owner-1",
                    10,
                    None,
                ))],
            )
            .await
            .unwrap();
        begin_optimistic_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Unknown {
                record_key: key.clone(),
                profile: profile(),
                partition: token("document"),
                affected_attributes: vec![],
            }],
        )
        .await;
        assert_eq!(
            engine.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Incomplete
        );

        begin_optimistic_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Patch {
                record_key: key.clone(),
                profile: profile(),
                partition: token("document"),
                exact: vec![
                    ExactAttributePatch {
                        attribute: token("owner"),
                        values: vec![ExactValue::utf8("owner-1").unwrap()],
                    },
                    ExactAttributePatch {
                        attribute: token("project-id"),
                        values: vec![],
                    },
                ],
                integers: vec![IntegerAttributePatch {
                    attribute: token("updated-at"),
                    values: vec![10],
                }],
                sorts: vec![IntegerFact {
                    attribute: token("updated-at"),
                    value: 10,
                }],
            }],
        )
        .await;
        assert_eq!(
            engine.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Optimistic(vec![key.clone()])
        );

        let missing = RecordKey::new("GraphqlSoupDocument:missing").unwrap();
        engine
            .mark_projections_incomplete(vec![ProjectionMutation::MarkIncomplete {
                record_key: missing.clone(),
                profile: profile(),
                partition: token("document"),
                kind: ProjectionIncompleteKind::Missing,
            }])
            .await
            .unwrap();
        assert_eq!(
            engine.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Incomplete
        );
        begin_optimistic_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Replace(document(
                missing.as_str(),
                "owner-2",
                12,
                None,
            ))],
        )
        .await;
        assert_eq!(
            engine.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Optimistic(vec![key])
        );
    });
}

#[test]
fn turso_rehydrates_and_queries_durable_optimistic_projection_layers() {
    pollster::block_on(async {
        let storage = TursoStorage::open_in_memory("predicate-optimistic").unwrap();
        let mut engine = Engine::new(storage);
        let base = document("GraphqlSoupDocument:1", "owner-1", 10, None);
        engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey::entity("GraphqlSoupDocument", &["1"]),
                    Record::default(),
                )],
                vec![ProjectionMutation::Replace(base)],
            )
            .await
            .unwrap();
        let data = serde_json::json!({
            "setEntityProperty": {
                "id": "prop-1",
                "displayName": "Status",
                "value": {
                    "__typename": "GraphqlStringPropertyValue",
                    "stringValue": "doing"
                }
            }
        });
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
        engine
            .begin_optimistic_write_with_projections(
                None,
                BeginOptimisticWrite {
                    query: r#"
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
                    "#,
                    operation_name: Some("SetEntityProperty"),
                    variables: &variables,
                    data: &data,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
                vec![OptimisticProjectionMutation::Replace(document(
                    "GraphqlSoupDocument:1",
                    "owner-1",
                    20,
                    None,
                ))],
            )
            .await
            .unwrap();

        let mut reopened = Engine::new(engine.into_storage());
        assert_eq!(
            reopened.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Optimistic(vec![
                RecordKey::new("GraphqlSoupDocument:1").unwrap()
            ])
        );
    });
}
