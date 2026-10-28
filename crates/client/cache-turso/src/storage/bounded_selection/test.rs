use super::*;
use crate::storage::test::{authoritative_projection, queued};
use pollster::block_on;
use predicate_index::{ExactValue, IndexDocument, PartitionPredicate, evaluate_reference};

fn query(
    predicate: PredicateExpr,
    direction: SortDirection,
    tie: SortDirection,
) -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: Profile::new(Token::new("profile-v1").unwrap()),
        partitions: vec![PartitionPredicate {
            partition: Token::new("thing").unwrap(),
            predicate,
        }],
        sort_attribute: Token::new("updated-at").unwrap(),
        sort_direction: direction,
        tie_break_direction: tie,
        limit: 20,
    })
    .unwrap()
}

fn owner(value: &str) -> PredicateExpr {
    PredicateExpr::Exact {
        attribute: Token::new("owner").unwrap(),
        value: ExactValue::utf8(value).unwrap(),
    }
}

fn document(n: u32, timestamp: i64) -> IndexDocument {
    let mut doc = authoritative_projection(&format!("Thing:{n:05}"), "owner");
    doc.sort_facts[0].value = timestamp;
    doc
}

fn hits(
    connection: &Arc<Connection>,
    query: &ValidatedIndexQuery,
    excluded: &[i64],
) -> Vec<(String, i64)> {
    select(connection, query, excluded, true)
        .unwrap()
        .iter()
        .map(|row| {
            (
                required_text(row, 0).unwrap(),
                required_i64(row, 1).unwrap(),
            )
        })
        .collect()
}

fn reference(
    connection: &Arc<Connection>,
    query: &ValidatedIndexQuery,
    excluded: &[i64],
) -> Vec<(String, i64)> {
    let (sql, parameters) = compile_predicate_selection(query, excluded, true);
    driver::query(connection, &sql, parameters)
        .unwrap()
        .iter()
        .map(|row| {
            (
                required_text(row, 0).unwrap(),
                required_i64(row, 1).unwrap(),
            )
        })
        .collect()
}

#[test]
fn dense_pages_have_a_corpus_independent_vm_budget() {
    block_on(async {
        for count in [1_000, 5_000] {
            let mut storage = TursoStorage::open_in_memory("bounded-dense").unwrap();
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    (0..count)
                        .map(|n| ProjectionMutation::Replace(document(n, i64::from(n))))
                        .collect(),
                )
                .await
                .unwrap();
            let predicate = PredicateExpr::And(
                Box::new(owner("owner")),
                Box::new(PredicateExpr::Not(Box::new(owner("excluded")))),
            );
            for direction in [SortDirection::Asc, SortDirection::Desc] {
                let query = query(predicate.clone(), direction, direction);
                let (sql, parameters) =
                    candidate_sql(query.as_query(), conjunction::FactSource::Authority, &[]);
                let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
                let rows = driver::query_prepared(&mut statement, parameters).unwrap();
                assert_eq!(rows.len(), MIN_CANDIDATES);
                assert!(
                    statement.metrics().vm_steps < 20_000,
                    "{count} records: {} VM steps",
                    statement.metrics().vm_steps
                );
                assert!(
                    try_select(&storage.connection(), &query, &[])
                        .unwrap()
                        .is_some()
                );
                assert_eq!(
                    hits(&storage.connection(), &query, &[]),
                    reference(&storage.connection(), &query, &[])
                );
                let first = hits(&storage.connection(), &query, &[]);
                let (key, value) = first.last().unwrap();
                let next = query
                    .after(*value, PredicateRecordKey::new(key.clone()).unwrap())
                    .unwrap();
                assert!(
                    try_select(&storage.connection(), &next, &[])
                        .unwrap()
                        .is_some()
                );
                assert_eq!(
                    hits(&storage.connection(), &next, &[]),
                    reference(&storage.connection(), &next, &[])
                );
            }
        }
    });
}

#[test]
fn ties_sparse_matches_and_unrelated_scopes_fall_back_without_losing_results() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-fallback").unwrap();
        let docs = (0..200)
            .rev()
            .map(|n| {
                let mut doc = document(n, 5);
                if n < 10 {
                    doc.exact_facts[0].value = ExactValue::utf8("rare").unwrap();
                }
                if n % 4 == 0 {
                    doc.profile = Profile::new(Token::new("other").unwrap());
                }
                if n % 7 == 0 {
                    doc.partition = Token::new("other").unwrap();
                }
                if n % 11 == 0 {
                    doc.sort_facts.clear();
                }
                doc
            })
            .collect::<Vec<_>>();
        storage
            .put_batch_with_projections(
                Vec::new(),
                docs.iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            for tie in [SortDirection::Asc, SortDirection::Desc] {
                for predicate in [
                    PredicateExpr::All,
                    owner("rare"),
                    PredicateExpr::Not(Box::new(owner("rare"))),
                    PredicateExpr::None,
                ] {
                    let query = query(predicate, direction, tie);
                    assert!(
                        try_select(&storage.connection(), &query, &[])
                            .unwrap()
                            .is_none()
                    );
                    let expected = evaluate_reference(&query, &docs)
                        .into_iter()
                        .map(|hit| (hit.record_key.as_str().to_owned(), hit.sort_value))
                        .collect::<Vec<_>>();
                    assert_eq!(hits(&storage.connection(), &query, &[]), expected);
                    if let Some((key, value)) = expected.last() {
                        let next = query
                            .after(*value, PredicateRecordKey::new(key.clone()).unwrap())
                            .unwrap();
                        assert_eq!(
                            hits(&storage.connection(), &next, &[]),
                            reference(&storage.connection(), &next, &[])
                        );
                    }
                }
            }
        }
    });
}

#[test]
fn complete_cutoff_ties_use_record_keys_not_internal_document_ids() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-ties").unwrap();
        let docs = (0..200)
            .rev()
            .map(|n| document(n, i64::from(n / 7)))
            .collect::<Vec<_>>();
        storage
            .put_batch_with_projections(
                Vec::new(),
                docs.iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            for tie in [SortDirection::Asc, SortDirection::Desc] {
                let query = query(PredicateExpr::All, direction, tie);
                assert!(
                    try_select(&storage.connection(), &query, &[])
                        .unwrap()
                        .is_some()
                );
                let first = hits(&storage.connection(), &query, &[]);
                assert_eq!(first, reference(&storage.connection(), &query, &[]));
                let (key, value) = first.last().unwrap();
                let next = query
                    .after(*value, PredicateRecordKey::new(key.clone()).unwrap())
                    .unwrap();
                assert!(
                    try_select(&storage.connection(), &next, &[])
                        .unwrap()
                        .is_some()
                );
                assert_eq!(
                    hits(&storage.connection(), &next, &[]),
                    reference(&storage.connection(), &next, &[])
                );
            }
        }
    });
}

#[test]
fn optimistic_moves_deletes_and_uncertainty_suppress_authority() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-shadows").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..120)
                    .map(|n| ProjectionMutation::Replace(document(n, i64::from(n))))
                    .collect(),
            )
            .await
            .unwrap();
        let complete = |document| PendingOptimisticProjection {
            state: OptimisticProjectionState::Complete(document),
            uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
        };
        let mut moved = document(119, 119);
        moved.partition = Token::new("other").unwrap();
        let mut missing_sort = document(118, 118);
        missing_sort.sort_facts.clear();
        storage
            .enqueue_mutation_with_shadow(
                queued("Bounded"),
                vec![
                    complete(moved),
                    complete(missing_sort),
                    complete(document(117, -10)),
                    PendingOptimisticProjection {
                        state: OptimisticProjectionState::Deleted {
                            record_key: document(116, 116).record_key,
                            profile: Profile::new(Token::new("profile-v1").unwrap()),
                            partition: Token::new("thing").unwrap(),
                        },
                        uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                    },
                    PendingOptimisticProjection {
                        state: OptimisticProjectionState::Complete(document(115, 1000)),
                        uncertainty: OptimisticUncertainty::Attributes(
                            [Token::new("owner").unwrap()].into(),
                        ),
                    },
                    complete(document(200, 999)),
                ],
            )
            .await
            .unwrap();
        let query = query(owner("owner"), SortDirection::Desc, SortDirection::Asc);
        let status = optimistic_query_status(&storage.connection(), &query).unwrap();
        assert_eq!(status.uncertain_ids.len(), 1);
        assert!(
            try_select(&storage.connection(), &query, &status.uncertain_ids)
                .unwrap()
                .is_some()
        );
        let actual = hits(&storage.connection(), &query, &status.uncertain_ids);
        assert_eq!(
            actual,
            reference(&storage.connection(), &query, &status.uncertain_ids)
        );
        assert_eq!(actual[0], ("Thing:00200".to_owned(), 999));
        assert!(actual.iter().all(|(key, _)| {
            ![
                "Thing:00115",
                "Thing:00116",
                "Thing:00117",
                "Thing:00118",
                "Thing:00119",
            ]
            .contains(&key.as_str())
        }));
        let result = storage
            .reconcile_predicate_index(&query, &[])
            .await
            .unwrap();
        assert_eq!(
            result
                .keys
                .iter()
                .map(|key| key.as_str())
                .collect::<Vec<_>>(),
            actual
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>()
        );
    });
}

#[test]
fn exhausted_windows_and_multi_partition_queries_match_the_original_plan() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-exhausted").unwrap();
        for count in [0, 5] {
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    (0..count)
                        .map(|n| ProjectionMutation::Replace(document(n, i64::from(n))))
                        .collect(),
                )
                .await
                .unwrap();
            let one = query(PredicateExpr::All, SortDirection::Desc, SortDirection::Desc);
            assert!(
                try_select(&storage.connection(), &one, &[])
                    .unwrap()
                    .is_some()
            );
            assert_eq!(
                hits(&storage.connection(), &one, &[]),
                reference(&storage.connection(), &one, &[])
            );
            let mut descriptor = one.as_query().clone();
            descriptor.partitions.push(PartitionPredicate {
                partition: Token::new("other").unwrap(),
                predicate: PredicateExpr::All,
            });
            let multi = ValidatedIndexQuery::new(descriptor).unwrap();
            assert!(
                try_select(&storage.connection(), &multi, &[])
                    .unwrap()
                    .is_none()
            );
            assert_eq!(
                hits(&storage.connection(), &multi, &[]),
                reference(&storage.connection(), &multi, &[])
            );
            let direct = storage.query_predicate_index(&one).await.unwrap();
            let PredicateQueryResult::Complete(keys) = direct else {
                panic!("expected complete page")
            };
            assert_eq!(keys.len(), count as usize);
        }
    });
}
