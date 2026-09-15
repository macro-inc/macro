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
