#![cfg(not(target_arch = "wasm32"))]

use cache_core::{
    predicate::{
        PredicateIndexStorage, PredicateQueryResult, ProjectionIncompleteKind, ProjectionMutation,
    },
    store::Storage,
    value::{EntityKey, Record},
};
use cache_turso::TursoStorage;
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, IndexQuery, IntegerFact, PartitionPredicate,
    PredicateExpr, Profile, RangeBound, RecordKey, SortDirection, Token, ValidatedIndexQuery,
    evaluate_reference,
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
                (
                    EntityKey::entity(
                        document.record_key.as_str().split(':').next().unwrap(),
                        &[document.record_key.as_str().split_once(':').unwrap().1],
                    ),
                    Record::default(),
                )
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
