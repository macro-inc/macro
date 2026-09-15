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
