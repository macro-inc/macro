use super::*;
use predicate_index::{ExactValue, IndexQuery, PartitionPredicate};

#[test]
fn compound_predicates_materialize_sets_once_instead_of_reexecuting_for_each_join_row() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("predicate-cost").unwrap();
        let projections = (0..75)
            .map(|n| {
                ProjectionMutation::Replace(authoritative_projection(
                    &format!("Thing:{n:03}"),
                    if n % 2 == 0 { "owner-1" } else { "owner-2" },
                ))
            })
            .collect();
        storage
            .put_batch_with_projections(Vec::new(), projections)
            .await
            .unwrap();
        let token = |value| Token::new(value).unwrap();
        let query = ValidatedIndexQuery::new(IndexQuery {
            profile: Profile::new(token("profile-v1")),
            partitions: ["thing", "other", "third", "fourth"]
                .into_iter()
                .map(|partition| PartitionPredicate {
                    partition: token(partition),
                    predicate: PredicateExpr::And(
                        Box::new(PredicateExpr::Exact {
                            attribute: token("owner"),
                            value: ExactValue::utf8("owner-1").unwrap(),
                        }),
                        Box::new(PredicateExpr::Exact {
                            attribute: token("server-relation"),
                            value: ExactValue::new([1]).unwrap(),
                        }),
                    ),
                })
                .collect(),
            sort_attribute: token("updated-at"),
            sort_direction: SortDirection::Asc,
            tie_break_direction: SortDirection::Asc,
            limit: 100,
        })
        .unwrap();
        let (sql, parameters) = compile_predicate_selection(&query, &[], true);
        let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
        let rows = driver::query_prepared(&mut statement, parameters).unwrap();
        let actual: Vec<_> = rows
            .iter()
            .map(|row| required_text(row, 0).unwrap())
            .collect();
        let expected: Vec<_> = (0..75)
            .filter(|n| n % 2 == 0)
            .map(|n| format!("Thing:{n:03}"))
            .collect();
        assert_eq!(actual, expected);
        // A VM-work budget is deterministic across machines/build profiles. The
        // unmaterialized compound plan takes millions of steps on only 75 rows.
        let steps = statement.metrics().vm_steps;
        assert!(steps < 500_000, "compound query executed {steps} VM steps");
    });
}

/// A bounded page must use point lookups for sort facts, not repeatedly scan
/// every row with the requested sort attribute. Exercise each SQL source leg
/// independently so the usually small optimistic set cannot hide a bad plan.
#[test]
fn sort_fact_lookups_stay_linear_at_thousands_of_matches() {
    block_on(async {
        for optimistic in [false, true] {
            for count in [1_000_u32, 3_000] {
                let mut storage = TursoStorage::open_in_memory("sort-lookup-cost").unwrap();
                let documents = (0..count)
                    .map(|n| {
                        let mut document =
                            authoritative_projection(&format!("Thing:{n:05}"), "owner-1");
                        // Include ties and rows lacking this sort attribute.
                        document.sort_facts = if n % 7 == 0 {
                            Vec::new()
                        } else {
                            vec![predicate_index::IntegerFact {
                                attribute: Token::new("updated-at").unwrap(),
                                value: i64::from(n / 3),
                            }]
                        };
                        document
                    })
                    .collect::<Vec<_>>();
                if optimistic {
                    storage
                        .enqueue_mutation_with_shadow(
                            queued("SortLookupCost"),
                            documents
                                .into_iter()
                                .map(|document| PendingOptimisticProjection {
                                    state: OptimisticProjectionState::Complete(document),
                                    uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                                })
                                .collect(),
                        )
                        .await
                        .unwrap();
                } else {
                    storage
                        .put_batch_with_projections(
                            Vec::new(),
                            documents
                                .into_iter()
                                .map(ProjectionMutation::Replace)
                                .collect(),
                        )
                        .await
                        .unwrap();
                }

                for direction in [SortDirection::Asc, SortDirection::Desc] {
                    let query = ValidatedIndexQuery::new(IndexQuery {
                        profile: Profile::new(Token::new("profile-v1").unwrap()),
                        partitions: vec![PartitionPredicate {
                            partition: Token::new("thing").unwrap(),
                            predicate: PredicateExpr::All,
                        }],
                        sort_attribute: Token::new("updated-at").unwrap(),
                        sort_direction: direction,
                        tie_break_direction: direction,
                        limit: 100,
                    })
                    .unwrap();
                    let (sql, parameters) = compile_predicate_selection(&query, &[], true);
                    let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
                    let rows = driver::query_prepared(&mut statement, parameters).unwrap();
                    let actual = rows
                        .iter()
                        .map(|row| {
                            (
                                required_text(row, 0).unwrap(),
                                required_i64(row, 1).unwrap(),
                            )
                        })
                        .collect::<Vec<_>>();
                    let mut expected = (0..count).filter(|n| n % 7 != 0).collect::<Vec<_>>();
                    if direction == SortDirection::Desc {
                        expected.reverse();
                    }
                    let expected = expected
                        .into_iter()
                        .take(100)
                        .map(|n| (format!("Thing:{n:05}"), i64::from(n / 3)))
                        .collect::<Vec<_>>();
                    assert_eq!(actual, expected);
                    let steps = statement.metrics().vm_steps;
                    let budget = u64::from(count) * 300;
                    assert!(
                        steps < budget,
                        "sort lookup: {count} rows, optimistic={optimistic}, {direction:?}: \
                         {steps} VM steps exceeds linear budget {budget}"
                    );
                }
            }
        }
    });
}

#[test]
fn exact_alternatives_use_one_lookup_without_widening_nested_boolean_filters() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("exact-alternatives").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..75)
                    .map(|n| {
                        ProjectionMutation::Replace(authoritative_projection(
                            &format!("Thing:{n:03}"),
                            if n % 2 == 0 { "owner-1" } else { "owner-2" },
                        ))
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let token = |value| Token::new(value).unwrap();
        let owner = |value: &str| PredicateExpr::Exact {
            attribute: token("owner"),
            value: ExactValue::utf8(value).unwrap(),
        };
        let alternatives = (1..=16)
            .map(|n| owner(&format!("owner-{n}")))
            .reduce(|left, right| PredicateExpr::Or(Box::new(left), Box::new(right)))
            .unwrap();
        for (predicate, expected) in [
            (alternatives.clone(), 75),
            (PredicateExpr::Not(Box::new(alternatives.clone())), 0),
            (
                PredicateExpr::And(
                    Box::new(alternatives),
                    Box::new(PredicateExpr::Not(Box::new(owner("owner-2")))),
                ),
                38,
            ),
        ] {
            let query = ValidatedIndexQuery::new(IndexQuery {
                profile: Profile::new(token("profile-v1")),
                partitions: vec![PartitionPredicate {
                    partition: token("thing"),
                    predicate,
                }],
                sort_attribute: token("updated-at"),
                sort_direction: SortDirection::Asc,
                tie_break_direction: SortDirection::Asc,
                limit: 100,
            })
            .unwrap();
            let (sql, parameters) = compile_predicate_selection(&query, &[], true);
            assert!(sql.contains("f.value IN ("));
            assert!(
                sql.matches("FROM exact_facts AS f").count() <= 2,
                "one lookup for alternatives, at most one for negated owner"
            );
            let rows = driver::query(&storage.connection(), &sql, parameters).unwrap();
            assert_eq!(rows.len(), expected);
        }
        let mixed = PredicateExpr::Or(
            Box::new(owner("owner-1")),
            Box::new(PredicateExpr::Exact {
                attribute: token("other"),
                value: ExactValue::utf8("owner-2").unwrap(),
            }),
        );
        assert!(alternatives::exact_alternatives(&mixed).is_none());
    });
}
