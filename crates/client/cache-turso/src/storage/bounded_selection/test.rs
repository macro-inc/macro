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

fn hits(connection: &Db, query: &ValidatedIndexQuery, excluded: &[i64]) -> Vec<(String, i64)> {
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

fn reference(connection: &Db, query: &ValidatedIndexQuery, excluded: &[i64]) -> Vec<(String, i64)> {
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
                    true,
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
                    true,
                );
                let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
                let rows = driver::query_prepared(&mut statement, parameters).unwrap();
                // The window is the 64 values from the middle on, whatever
                // order the rows come back in.
                let mut values = rows
                    .iter()
                    .map(|row| required_i64(row, 1).unwrap())
                    .collect::<Vec<_>>();
                values.sort_unstable();
                let window = MIN_CANDIDATES as i64;
                let start = match direction {
                    SortDirection::Asc => middle.value,
                    SortDirection::Desc => middle.value - window + 1,
                };
                assert_eq!(values, (start..start + window).collect::<Vec<_>>());
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

/// The shadow probe and the optimistic window run exactly while a pending
/// write holds optimistic documents, and the page follows the layer both ways.
#[test]
fn the_shadow_probe_runs_only_while_optimistic_documents_exist() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-pending").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..40)
                    .map(|n| ProjectionMutation::Replace(document(n, i64::from(n))))
                    .collect(),
            )
            .await
            .unwrap();
        let query = query(owner("owner"), SortDirection::Desc, SortDirection::Asc);
        // The connection keeps a statement text from its second use, so the
        // selector runs twice on an emptied statement cache, and the kept
        // texts show whether it ran the shadow probe and the optimistic window.
        let page = |storage: &TursoStorage| {
            let connection = storage.connection();
            connection.release_statements();
            for _ in 0..2 {
                assert!(try_select(&connection, &query, &[]).unwrap().is_some());
            }
            let ran = Ran {
                pending: has_optimistic_documents(&connection).unwrap(),
                shadow_probe: connection.cached_texts_containing(SHADOW_PROBE) > 0,
                optimistic_window: connection.cached_texts_containing(OPTIMISTIC_WINDOW) > 0,
            };
            let actual = hits(&connection, &query, &[]);
            assert_eq!(actual, reference(&connection, &query, &[]));
            (ran, actual)
        };
        let idle = Ran {
            pending: false,
            shadow_probe: false,
            optimistic_window: false,
        };
        let (ran, before) = page(&storage);
        assert_eq!(ran, idle);
        assert_eq!(before[0], ("Thing:00039".to_owned(), 39));

        let mut moved = document(39, 39);
        moved.partition = Token::new("other").unwrap();
        let id = storage
            .enqueue_mutation_with_shadow(
                queued("Pending"),
                vec![
                    PendingOptimisticProjection {
                        state: OptimisticProjectionState::Complete(moved),
                        uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                    },
                    PendingOptimisticProjection {
                        state: OptimisticProjectionState::Complete(document(100, 100)),
                        uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                    },
                ],
            )
            .await
            .unwrap();
        let (ran, shadowed) = page(&storage);
        assert_eq!(
            ran,
            Ran {
                pending: true,
                shadow_probe: true,
                optimistic_window: true,
            }
        );
        assert_eq!(shadowed[0], ("Thing:00100".to_owned(), 100));
        assert!(!shadowed.iter().any(|(key, _)| key == "Thing:00039"));

        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 10,
            })
            .await
            .unwrap()
            .unwrap();
        assert!(
            storage
                .discard_mutation(
                    id,
                    MutationClaimToken {
                        owner: "runner".into(),
                        generation: claimed.lease_generation,
                    },
                )
                .await
                .unwrap()
        );
        assert_eq!(page(&storage), (idle, before));
    });
}

/// What one selection ran, read back from the connection's statement cache.
#[derive(Debug, PartialEq)]
struct Ran {
    pending: bool,
    shadow_probe: bool,
    optimistic_window: bool,
}

const SHADOW_PROBE: &str = "FROM optimistic_index_documents AS o WHERE o.record_key = d.record_key";
const OPTIMISTIC_WINDOW: &str = "INDEXED BY optimistic_sort_facts_lookup_idx";

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
                    .is_some()
            );
            assert_eq!(
                hits(&storage.connection(), &multi, &[]),
                reference(&storage.connection(), &multi, &[])
            );
            // Partitions that match nothing leave no window to read.
            let mut nothing = multi.as_query().clone();
            for partition in &mut nothing.partitions {
                partition.predicate = PredicateExpr::None;
            }
            let nothing = ValidatedIndexQuery::new(nothing).unwrap();
            assert!(
                try_select(&storage.connection(), &nothing, &[])
                    .unwrap()
                    .is_none()
            );
            assert!(hits(&storage.connection(), &nothing, &[]).is_empty());
            let direct = storage.query_predicate_index(&one).await.unwrap();
            let PredicateQueryResult::Complete(keys) = direct else {
                panic!("expected complete page")
            };
            assert_eq!(keys.len(), count as usize);
        }
    });
}

/// Partitions with different cursors, or one without any, read from the
/// loosest bound: no partition loses rows to another's tighter cursor.
#[test]
fn partitions_with_different_cursors_read_from_the_loosest_bound() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-cursors").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..80)
                    .map(|n| {
                        let mut doc = document(n, i64::from(n));
                        if n % 2 == 1 {
                            doc.partition = Token::new("other").unwrap();
                        }
                        ProjectionMutation::Replace(doc)
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let connection = storage.connection();
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let after = |value: i64| PredicateExpr::After {
                attribute: Token::new("updated-at").unwrap(),
                value,
                key: PredicateRecordKey::new(format!("Thing:{value:05}")).unwrap(),
                direction,
                tie_direction: direction,
            };
            // Even records sit in "thing", odd ones in "other"; "other"'s
            // first row lies past "thing"'s cursor only in the loose window.
            let (thing, other, first) = match direction {
                SortDirection::Asc => (after(50), [after(20), PredicateExpr::All], [21, 1]),
                SortDirection::Desc => (after(30), [after(60), PredicateExpr::All], [59, 79]),
            };
            for (other, first) in other.into_iter().zip(first) {
                let mut descriptor = query(thing.clone(), direction, direction)
                    .as_query()
                    .clone();
                descriptor.partitions.push(PartitionPredicate {
                    partition: Token::new("other").unwrap(),
                    predicate: other,
                });
                let query = ValidatedIndexQuery::new(descriptor).unwrap();
                assert!(try_select(&connection, &query, &[]).unwrap().is_some());
                let page = hits(&connection, &query, &[]);
                assert_eq!(page, reference(&connection, &query, &[]));
                assert_eq!(page[0], (format!("Thing:{first:05}"), first));
            }
        }
    });
}

/// Predicates `levels` deep in each nesting the window's SQL can take, every
/// one matching all records: negated and plain owner tests chained down to a
/// cursor probe (the deepest fact probe), the negated chain nested to the
/// left, and an `Or` over distinct attributes.
fn nested_predicates(levels: usize) -> [(&'static str, PredicateExpr); 4] {
    let cursor = PredicateExpr::After {
        attribute: Token::new("updated-at").unwrap(),
        value: 1_000,
        key: PredicateRecordKey::new("Thing:99999").unwrap(),
        direction: SortDirection::Desc,
        tie_direction: SortDirection::Asc,
    };
    let not_owner = |level: usize| PredicateExpr::Not(Box::new(owner(&format!("x{level}"))));
    let right = (0..levels).fold(cursor.clone(), |rest, level| {
        PredicateExpr::And(Box::new(not_owner(level)), Box::new(rest))
    });
    let positive = (0..levels).fold(cursor.clone(), |rest, _| {
        PredicateExpr::And(Box::new(owner("owner")), Box::new(rest))
    });
    let left = (0..levels).fold(cursor, |rest, level| {
        PredicateExpr::And(Box::new(rest), Box::new(not_owner(level)))
    });
    let or = (0..levels).fold(owner("owner"), |rest, level| {
        PredicateExpr::Or(
            Box::new(PredicateExpr::Exact {
                attribute: Token::new(format!("attribute-{level}")).unwrap(),
                value: ExactValue::utf8("v").unwrap(),
            }),
            Box::new(rest),
        )
    });
    [
        ("right", right),
        ("positive", positive),
        ("left", left),
        ("or", or),
    ]
}

/// Turso refuses SQL nested past its parser's limits, and the optimistic
/// window joins every partition's predicate into one expression. While a
/// local write is pending, across predicate depths up to the deepest a query
/// may hold and partition counts past 64, the window runs exactly when Turso
/// prepares that SQL, never fails, and pages like the set-based plan, which
/// serves the queries just past the limit.
#[test]
fn many_partitions_with_deep_predicates_stay_within_the_expression_limit() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-depth").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..240)
                    .map(|n| {
                        let mut doc = document(n, i64::from(n));
                        doc.partition = Token::new(format!("p{}", n % 8)).unwrap();
                        ProjectionMutation::Replace(doc)
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let mut pending = document(1_000, 1_000);
        pending.partition = Token::new("other").unwrap();
        storage
            .enqueue_mutation_with_shadow(
                queued("Pending"),
                vec![PendingOptimisticProjection {
                    state: OptimisticProjectionState::Complete(pending),
                    uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                }],
            )
            .await
            .unwrap();
        let connection = storage.connection();
        let query = |predicate: &PredicateExpr, count: usize| {
            let mut descriptor = query(PredicateExpr::All, SortDirection::Desc, SortDirection::Asc)
                .as_query()
                .clone();
            descriptor.partitions = (0..count)
                .map(|n| PartitionPredicate {
                    partition: Token::new(format!("p{n}")).unwrap(),
                    predicate: predicate.clone(),
                })
                .collect();
            ValidatedIndexQuery::new(descriptor).ok()
        };
        let refused = |query: &ValidatedIndexQuery| {
            let (sql, _) = candidate_sql(
                query.as_query(),
                conjunction::FactSource::Optimistic,
                &[],
                None,
                64,
                true,
            );
            driver::prepare_unless_refused(&connection, &sql)
                .unwrap()
                .is_none()
        };
        let mut sides = std::collections::HashMap::new();
        for count in [1, 2, 3, 5, 9, 65, 129] {
            for shape in 0..nested_predicates(0).len() {
                let queries = (0..predicate_index::MAX_EXPRESSION_DEPTH)
                    .filter_map(|levels| {
                        let (name, predicate) = nested_predicates(levels)[shape].clone();
                        query(&predicate, count).map(|query| (name, levels, query))
                    })
                    .collect::<Vec<_>>();
                let refusals = queries
                    .iter()
                    .map(|(_, _, query)| refused(query))
                    .collect::<Vec<_>>();
                // Once Turso refuses a nesting, it refuses every deeper one.
                let first_refused = refusals.iter().position(|refused| *refused);
                if let Some(first) = first_refused {
                    assert!(refusals[first..].iter().all(|refused| *refused));
                }
                let limit = first_refused.unwrap_or(queries.len());
                for (index, (name, levels, query)) in queries.iter().enumerate() {
                    // Both sides of the limit, and the shallowest queries; the
                    // set-based reference for deep predicates over many
                    // partitions takes seconds in a debug build.
                    let near_limit = index + 2 >= limit && index <= limit + 1;
                    if !(index < 2 || near_limit)
                        || (*name == "or" && count > 3)
                        || (count > 65 && index > 0)
                    {
                        continue;
                    }
                    let label = format!("{name} × {levels} levels × {count} partitions");
                    let windowed = try_select(&connection, query, &[])
                        .unwrap_or_else(|error| panic!("{label}: {error:?}"));
                    assert_eq!(windowed.is_some(), index < limit, "{label}");
                    let page = match windowed {
                        Some(windowed) => windowed
                            .into_iter()
                            .map(|hit| (hit.record_key.as_str().to_owned(), hit.sort_value))
                            .collect::<Vec<_>>(),
                        None => hits(&connection, query, &[]),
                    };
                    assert_eq!(page.len(), 20, "{label}");
                    assert_eq!(page, reference(&connection, query, &[]), "{label}");
                    sides.entry((*name, count)).or_insert([false; 2])
                        [usize::from(index >= limit)] = true;
                }
            }
        }
        // A single partition reaches the limit in every nesting: the window
        // serves the deepest queries Turso prepares, and the set-based plan
        // the shallowest it refuses.
        for name in ["right", "positive", "left", "or"] {
            assert_eq!(sides.get(&(name, 1)), Some(&[true, true]), "{name}");
        }
        // The balanced `OR` keeps 129 partitions windowed: joined in one chain,
        // they alone pass the limit.
        assert_eq!(sides.get(&("right", 129)).map(|sides| sides[0]), Some(true));
    });
}

/// The authority window tests predicates on each candidate's facts blob, so
/// with no local write pending no SQL holds a predicate and the window serves
/// every depth a query may hold, paging like the set-based plan wherever Turso
/// prepares that plan.
#[test]
fn without_pending_writes_the_window_serves_every_predicate_depth() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("bounded-depth-idle").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..240)
                    .map(|n| {
                        let mut doc = document(n, i64::from(n));
                        doc.partition = Token::new(format!("p{}", n % 8)).unwrap();
                        ProjectionMutation::Replace(doc)
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let connection = storage.connection();
        let mut compared = 0;
        for count in [1, 9, 129] {
            for (shape, levels) in [0, 1, 2, 3].into_iter().flat_map(|shape| {
                [0, 1, 31, predicate_index::MAX_EXPRESSION_DEPTH - 2].map(|levels| (shape, levels))
            }) {
                let (name, predicate) = nested_predicates(levels)[shape].clone();
                let mut descriptor =
                    query(PredicateExpr::All, SortDirection::Desc, SortDirection::Asc)
                        .as_query()
                        .clone();
                descriptor.partitions = (0..count)
                    .map(|n| PartitionPredicate {
                        partition: Token::new(format!("p{n}")).unwrap(),
                        predicate: predicate.clone(),
                    })
                    .collect();
                let Ok(query) = ValidatedIndexQuery::new(descriptor) else {
                    continue;
                };
                let label = format!("{name} × {levels} levels × {count} partitions");
                let page = try_select(&connection, &query, &[])
                    .unwrap_or_else(|error| panic!("{label}: {error:?}"))
                    .unwrap_or_else(|| panic!("{label}: not windowed"))
                    .into_iter()
                    .map(|hit| (hit.record_key.as_str().to_owned(), hit.sort_value))
                    .collect::<Vec<_>>();
                assert_eq!(page.len(), 20, "{label}");
                let (sql, parameters) = compile_predicate_selection(&query, &[], true);
                if let Some(mut statement) =
                    driver::prepare_unless_refused(&connection, &sql).unwrap()
                    && (count == 1 || levels < 2)
                {
                    let reference = driver::query_prepared(&mut statement, parameters)
                        .unwrap()
                        .iter()
                        .map(|row| {
                            (
                                required_text(row, 0).unwrap(),
                                required_i64(row, 1).unwrap(),
                            )
                        })
                        .collect::<Vec<_>>();
                    assert_eq!(page, reference, "{label}");
                    compared += 1;
                }
            }
        }
        assert!(compared >= 12, "{compared}");
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

/// `query` over one partition (shape 0), over a second partition with the
/// opposite filter (1), or over only the second partition while the first
/// matches nothing (2).
fn partitioned(query: ValidatedIndexQuery, shape: u8) -> ValidatedIndexQuery {
    let mut descriptor = query.as_query().clone();
    let predicate = descriptor.partitions[0].predicate.clone();
    let other = |predicate| PartitionPredicate {
        partition: Token::new("other").unwrap(),
        predicate,
    };
    match shape {
        1 => descriptor
            .partitions
            .push(other(PredicateExpr::Not(Box::new(predicate)))),
        2 => {
            descriptor.partitions[0].predicate = PredicateExpr::None;
            descriptor.partitions.push(other(predicate));
        }
        _ => {}
    }
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

/// `mixed(n)` with its owner swapped between "a" and "b".
fn reowned(n: u32, timestamp: i64) -> IndexDocument {
    let mut doc = mixed(n, timestamp);
    let owner = if n.is_multiple_of(10) { "b" } else { "a" };
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
                        // Rescored and re-owned: the shadow flips the key's
                        // owner between "a" and "b".
                        0 => complete(reowned(n + 10, i64::from(n % 200))),
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
                // The re-owned keys move between owners: "Thing:00010" from "a"
                // to "b", "Thing:00066" from "b" to "a".
                let all_pages = |predicate: PredicateExpr| {
                    let mut page =
                        query_with_limit(predicate, SortDirection::Asc, SortDirection::Asc, 100);
                    let excluded = optimistic_query_status(&storage.connection(), &page)
                        .unwrap()
                        .uncertain_ids;
                    let mut keys = BTreeSet::new();
                    loop {
                        let actual = hits(&storage.connection(), &page, &excluded);
                        let Some((key, value)) = actual.last().cloned() else {
                            break keys;
                        };
                        keys.extend(actual.into_iter().map(|(key, _)| key));
                        page = page
                            .after(value, PredicateRecordKey::new(key).unwrap())
                            .unwrap();
                    }
                };
                let owned_by_a = all_pages(owner("a"));
                let owned_by_b = all_pages(owner("b"));
                for (key, new_owner, old_owner) in [
                    ("Thing:00010", &owned_by_b, &owned_by_a),
                    ("Thing:00066", &owned_by_a, &owned_by_b),
                ] {
                    assert!(new_owner.contains(key), "{key} missing from its new owner");
                    assert!(
                        !old_owner.contains(key),
                        "{key} still listed under its old owner"
                    );
                }
            }
            let (mut pages, mut widened) = (0, 0);
            for (predicate, shape) in predicates
                .iter()
                .flat_map(|predicate| [0u8, 1, 2].map(move |shape| (predicate, shape)))
            {
                for limit in [1u16, 7, 20, 100] {
                    for direction in [SortDirection::Asc, SortDirection::Desc] {
                        for tie in [SortDirection::Asc, SortDirection::Desc] {
                            let mut page = partitioned(
                                query_with_limit(predicate.clone(), direction, tie, limit),
                                shape,
                            );
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
                                        "{predicate:?} shape {shape} limit {limit} {direction:?}/{tie:?} shadowed {shadowed}"
                                    );
                                }
                                let actual = hits(&storage.connection(), &page, &excluded);
                                assert_eq!(
                                    actual, expected,
                                    "{predicate:?} shape {shape} limit {limit} {direction:?}/{tie:?} shadowed {shadowed}"
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
                true,
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
