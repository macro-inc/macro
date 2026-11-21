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
                let (sql, parameters) = candidate_sql(
                    query.as_query(),
                    conjunction::FactSource::Authority,
                    &[],
                    None,
                    candidate_budget(query.as_query()),
                );
                let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
                let rows = driver::query_prepared(&mut statement, parameters).unwrap();
                assert_eq!(rows.len(), MIN_CANDIDATES);
                assert!(
                    statement.metrics().vm_steps < 20_000,
                    "{count} records: {} VM steps",
                    statement.metrics().vm_steps
                );
                // A continuation seeks to its position: reading on from the
                // middle of the index costs what the first window did.
                let middle = Position {
                    value: i64::from(count / 2),
                    document: match direction {
                        SortDirection::Asc => i64::MIN,
                        SortDirection::Desc => i64::MAX,
                    },
                };
                let (sql, parameters) = candidate_sql(
                    query.as_query(),
                    conjunction::FactSource::Authority,
                    &[],
                    Some(middle),
                    candidate_budget(query.as_query()),
                );
                let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
                let rows = driver::query_prepared(&mut statement, parameters).unwrap();
                assert_eq!(rows.len(), MIN_CANDIDATES);
                assert_eq!(required_i64(&rows[0], 1).unwrap(), middle.value);
                assert!(
                    statement.metrics().vm_steps < 20_000,
                    "{count} records, continued: {} VM steps",
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
fn ties_sparse_matches_and_unrelated_scopes_widen_without_losing_results() {
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
                    let query = query(predicate.clone(), direction, tie);
                    // Two hundred records fit a widened window, so only None,
                    // which never speculates, takes the set-based plan.
                    assert_eq!(
                        try_select(&storage.connection(), &query, &[])
                            .unwrap()
                            .is_none(),
                        matches!(predicate, PredicateExpr::None)
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

fn query_with_limit(
    predicate: PredicateExpr,
    direction: SortDirection,
    tie: SortDirection,
    limit: u16,
) -> ValidatedIndexQuery {
    let mut descriptor = query(predicate, direction, tie).as_query().clone();
    descriptor.limit = limit;
    ValidatedIndexQuery::new(descriptor).unwrap()
}

/// Owner by position: "a" on every tenth record, "rare" on every thousandth,
/// "b" otherwise, so filters range from dense to far sparser than the cap.
fn mixed(n: u32, timestamp: i64) -> IndexDocument {
    let mut doc = document(n, timestamp);
    let owner = if n.is_multiple_of(1_000) {
        "rare"
    } else if n.is_multiple_of(10) {
        "a"
    } else {
        "b"
    };
    doc.exact_facts[0].value = ExactValue::utf8(owner).unwrap();
    doc
}

#[test]
fn sparse_filters_widen_to_a_page_and_stop_at_the_cap() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-widen").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..6_000)
                    .map(|n| ProjectionMutation::Replace(mixed(n, i64::from(n))))
                    .collect(),
            )
            .await
            .unwrap();
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            // One match in ten needs about ten times the first window.
            let sparse = query(owner("a"), direction, direction);
            assert!(
                try_select(&storage.connection(), &sparse, &[])
                    .unwrap()
                    .is_some()
            );
            let page = hits(&storage.connection(), &sparse, &[]);
            assert_eq!(page.len(), 20);
            assert_eq!(page, reference(&storage.connection(), &sparse, &[]));
            // Six matches in six thousand cannot fill a page inside the cap.
            let rare = query(owner("rare"), direction, direction);
            assert!(
                try_select(&storage.connection(), &rare, &[])
                    .unwrap()
                    .is_none()
            );
            assert_eq!(
                hits(&storage.connection(), &rare, &[]),
                reference(&storage.connection(), &rare, &[])
            );
        }
    });
}

#[test]
fn next_budget_grows_by_hit_rate_within_bounds() {
    // No hits yet: the largest step.
    assert_eq!(next_budget(64, 0, 20), Some(64 * MAX_GROWTH));
    // Most of a page: at least double.
    assert_eq!(next_budget(64, 19, 20), Some(128));
    // A page and a quarter at the observed rate: 64 * 25 / 5.
    assert_eq!(next_budget(64, 5, 20), Some(320));
    // Never past the cap, and nothing after it.
    assert_eq!(next_budget(2_048, 0, 20), Some(MAX_CANDIDATES));
    assert_eq!(next_budget(MAX_CANDIDATES, 0, 20), None);
    // A rate that cannot fill a page within the cap falls back at once.
    assert_eq!(next_budget(512, 1, 100), None);
}

/// Every page of every filter, limit, direction and tie order, read through
/// the widening plan, equals the set-based plan over the same snapshot, with
/// and without optimistic shadows that move, rescore, add and delete records.
#[test]
fn widened_windows_match_the_set_based_plan_on_every_page() {
    block_on(async {
        let docs = (0..900u32)
            .map(|n| {
                // Ties of three, then of thirty, so cutoffs and window ends
                // land inside ties.
                let timestamp = if n < 450 { n / 3 } else { 150 + n / 30 };
                let mut doc = mixed(n, i64::from(timestamp));
                if n % 13 == 0 {
                    doc.partition = Token::new("other").unwrap();
                }
                if n % 17 == 0 {
                    doc.profile = Profile::new(Token::new("other").unwrap());
                }
                if n % 19 == 0 {
                    doc.sort_facts.clear();
                }
                doc
            })
            .collect::<Vec<_>>();
        let predicates = [
            PredicateExpr::All,
            owner("a"),
            owner("b"),
            owner("rare"),
            owner("missing"),
            PredicateExpr::Not(Box::new(owner("b"))),
            PredicateExpr::And(
                Box::new(PredicateExpr::Not(Box::new(owner("a")))),
                Box::new(PredicateExpr::Not(Box::new(owner("rare")))),
            ),
            PredicateExpr::Or(Box::new(owner("a")), Box::new(owner("rare"))),
        ];
        for shadowed in [false, true] {
            let mut storage = TursoStorage::open_in_memory("bounded-sweep").unwrap();
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
            let mut excluded = Vec::new();
            if shadowed {
                let complete = |document| PendingOptimisticProjection {
                    state: OptimisticProjectionState::Complete(document),
                    uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                };
                let mut shadows = Vec::new();
                for n in (0..900u32).step_by(7) {
                    shadows.push(match n % 4 {
                        // Rescored and re-owned.
                        0 => complete(mixed(n + 10, i64::from(n % 200))),
                        1 => {
                            let mut moved = mixed(n, i64::from(n / 3));
                            moved.partition = Token::new("other").unwrap();
                            complete(moved)
                        }
                        2 => PendingOptimisticProjection {
                            state: OptimisticProjectionState::Deleted {
                                record_key: mixed(n, 0).record_key,
                                profile: Profile::new(Token::new("profile-v1").unwrap()),
                                partition: Token::new("thing").unwrap(),
                            },
                            uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                        },
                        _ => PendingOptimisticProjection {
                            state: OptimisticProjectionState::Complete(mixed(n, 400)),
                            uncertainty: OptimisticUncertainty::Attributes(
                                [Token::new("owner").unwrap()].into(),
                            ),
                        },
                    });
                }
                // New records only the optimistic layer holds.
                for n in 2_000..2_200u32 {
                    shadows.push(complete(mixed(n, i64::from(n % 500))));
                }
                storage
                    .enqueue_mutation_with_shadow(queued("Sweep"), shadows)
                    .await
                    .unwrap();
            }
            let (mut pages, mut widened) = (0, 0);
            for predicate in &predicates {
                for limit in [1u16, 7, 20, 100] {
                    for direction in [SortDirection::Asc, SortDirection::Desc] {
                        for tie in [SortDirection::Asc, SortDirection::Desc] {
                            let mut page =
                                query_with_limit(predicate.clone(), direction, tie, limit);
                            if shadowed {
                                excluded = optimistic_query_status(&storage.connection(), &page)
                                    .unwrap()
                                    .uncertain_ids;
                            }
                            for _ in 0..8 {
                                let expected = reference(&storage.connection(), &page, &excluded);
                                // `hits` falls back to the reference's own plan,
                                // so the windows' pages are compared directly.
                                pages += 1;
                                if let Some(windowed) =
                                    try_select(&storage.connection(), &page, &excluded).unwrap()
                                {
                                    widened += 1;
                                    assert_eq!(
                                        windowed
                                            .iter()
                                            .map(|hit| (
                                                hit.record_key.as_str().to_owned(),
                                                hit.sort_value
                                            ))
                                            .collect::<Vec<_>>(),
                                        expected,
                                        "{predicate:?} limit {limit} {direction:?}/{tie:?} shadowed {shadowed}"
                                    );
                                }
                                let actual = hits(&storage.connection(), &page, &excluded);
                                assert_eq!(
                                    actual, expected,
                                    "{predicate:?} limit {limit} {direction:?}/{tie:?} shadowed {shadowed}"
                                );
                                let Some((key, value)) = actual.last() else {
                                    break;
                                };
                                page = page
                                    .after(*value, PredicateRecordKey::new(key.clone()).unwrap())
                                    .unwrap();
                            }
                        }
                    }
                }
            }
            assert!(
                widened * 10 >= pages * 9,
                "{widened} of {pages} pages from the windows"
            );
        }
    });
}

/// The first window ends inside the tie that holds the page's last record, so
/// it cannot tell which tied records belong on the page; the window must widen
/// past the tie (or fall back) rather than return the tied records it holds.
#[test]
fn a_window_ending_inside_the_cutoff_tie_widens_past_it() {
    block_on(async {
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let sign = match direction {
                SortDirection::Asc => 1,
                SortDirection::Desc => -1,
            };
            let docs = (0..319u32)
                .rev()
                .map(|n| {
                    let value = match n {
                        0..19 => i64::from(n),
                        19..119 => 50,
                        _ => 100 + i64::from(n),
                    };
                    document(n, sign * value)
                })
                .collect::<Vec<_>>();
            let mut storage = TursoStorage::open_in_memory("bounded-cutoff-tie").unwrap();
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
            for tie in [SortDirection::Asc, SortDirection::Desc] {
                let query = query(PredicateExpr::All, direction, tie);
                let expected = evaluate_reference(&query, &docs)
                    .into_iter()
                    .map(|hit| (hit.record_key.as_str().to_owned(), hit.sort_value))
                    .collect::<Vec<_>>();
                assert_eq!(expected.len(), 20);
                assert_eq!(expected[19].1, sign * 50);
                assert_eq!(hits(&storage.connection(), &query, &[]), expected);
            }
        }
    });
}

/// A tie wider than the cap: every window of a page inside it ends inside it,
/// so the plan falls back to the set-based page. A continuation seeks to the
/// tie's start and steps over the part already read, so its cost grows with
/// how far into the tie the window has read, which the cap bounds.
#[test]
fn a_tie_wider_than_the_cap_falls_back_with_the_same_pages() {
    const TIE: u32 = 5_000;
    const TIED: i64 = 1_000;
    block_on(async {
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let sign = match direction {
                SortDirection::Asc => 1,
                SortDirection::Desc => -1,
            };
            let mut storage = TursoStorage::open_in_memory("bounded-wide-tie").unwrap();
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    (0..TIE + 40)
                        .map(|n| {
                            let value = if n < 20 {
                                i64::from(n)
                            } else if n < TIE + 20 {
                                TIED
                            } else {
                                TIED + i64::from(n)
                            };
                            ProjectionMutation::Replace(document(n, sign * value))
                        })
                        .collect(),
                )
                .await
                .unwrap();
            for tie in [SortDirection::Asc, SortDirection::Desc] {
                let mut page = query(PredicateExpr::All, direction, tie);
                // The first page ends before the tie and is proven by the
                // window; the next two lie inside it and fall back.
                for number in 0..3 {
                    assert_eq!(
                        try_select(&storage.connection(), &page, &[])
                            .unwrap()
                            .is_some(),
                        number == 0
                    );
                    let found = hits(&storage.connection(), &page, &[]);
                    assert_eq!(found.len(), 20);
                    assert_eq!(found, reference(&storage.connection(), &page, &[]));
                    let (key, value) = found.last().unwrap();
                    page = page
                        .after(*value, PredicateRecordKey::new(key.clone()).unwrap())
                        .unwrap();
                }
                assert!(
                    try_select(&storage.connection(), &page, &[])
                        .unwrap()
                        .is_none()
                );
            }
            // A continuation 4,000 records into the tie.
            let order = match direction {
                SortDirection::Asc => "ASC",
                SortDirection::Desc => "DESC",
            };
            let rows = driver::query(
                &storage.connection(),
                &format!(
                    "SELECT document_id FROM sort_facts WHERE value = ? ORDER BY document_id {order} LIMIT 1 OFFSET 4000"
                ),
                vec![Value::from_i64(sign * TIED)],
            )
            .unwrap();
            let position = Position {
                value: sign * TIED,
                document: required_i64(&rows[0], 0).unwrap(),
            };
            let query = query(PredicateExpr::All, direction, direction);
            let (sql, parameters) = candidate_sql(
                query.as_query(),
                conjunction::FactSource::Authority,
                &[],
                Some(position),
                MIN_CANDIDATES,
            );
            let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
            let rows = driver::query_prepared(&mut statement, parameters).unwrap();
            assert_eq!(rows.len(), MIN_CANDIDATES);
            let steps = statement.metrics().vm_steps;
            println!("{order}: a continuation 4,000 records into a tie: {steps} VM steps");
            assert!(steps < 40_000, "{steps} VM steps");
        }
    });
}

/// A full page whose cutoff tie runs past the window doubles the next window
/// rather than sizing it by the hit rate: with two results per page every
/// window holds a page, and a hit-rate estimate would give up before the cap.
#[test]
fn a_full_page_inside_a_tie_doubles_up_to_the_cap() {
    const TIE: u32 = 3_000;
    block_on(async {
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let sign = match direction {
                SortDirection::Asc => 1,
                SortDirection::Desc => -1,
            };
            let mut storage = TursoStorage::open_in_memory("bounded-full-tie").unwrap();
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    (0..TIE + 20)
                        .map(|n| {
                            let value = if n < TIE { 0 } else { i64::from(n) };
                            ProjectionMutation::Replace(document(n, sign * value))
                        })
                        .collect(),
                )
                .await
                .unwrap();
            for tie in [SortDirection::Asc, SortDirection::Desc] {
                let page = query_with_limit(PredicateExpr::All, direction, tie, 2);
                let proven = try_select(&storage.connection(), &page, &[])
                    .unwrap()
                    .expect("the cap reaches past the tie");
                let found = proven
                    .into_iter()
                    .map(|hit| (hit.record_key.as_str().to_owned(), hit.sort_value))
                    .collect::<Vec<_>>();
                assert_eq!(found, reference(&storage.connection(), &page, &[]));
            }
        }
    });
}
