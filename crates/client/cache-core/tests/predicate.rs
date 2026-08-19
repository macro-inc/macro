use cache_core::{
    engine::{BeginOptimisticWrite, Engine},
    predicate::{PredicateQueryResult, ProjectionIncompleteKind, ProjectionMutation},
    store::InMemoryStorage,
    value::{EntityKey, Record},
};
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, IndexQuery, IntegerFact, OptimisticProjectionMutation,
    PartitionPredicate, PredicateExpr, Profile, RecordKey, SortDirection, Token,
    ValidatedIndexQuery,
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
    IndexDocument {
        record_key: record_key(),
        profile: profile(),
        partition: token("document"),
        exact_facts: vec![ExactFact {
            attribute: token("owner"),
            value: ExactValue::utf8(owner).unwrap(),
        }],
        integer_facts: vec![],
        sort_facts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: 10,
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

async fn begin_with_projection(
    engine: &mut Engine<InMemoryStorage>,
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
            PredicateQueryResult::Complete(vec![])
        );
        assert_eq!(
            engine
                .query_predicate_index(&query("owner-2"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![record_key()])
        );

        let storage = engine.into_storage();
        let mut reopened = Engine::new(storage);
        assert_eq!(
            reopened
                .query_predicate_index(&query("owner-2"))
                .await
                .unwrap(),
            PredicateQueryResult::Complete(vec![record_key()])
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
            PredicateQueryResult::Complete(vec![record_key()])
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
            PredicateQueryResult::Complete(vec![])
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
