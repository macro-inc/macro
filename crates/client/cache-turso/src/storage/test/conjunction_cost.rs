use super::*;
use predicate_index::{ExactValue, IndexQuery, PartitionPredicate};

#[test]
fn sparse_conjunction_probes_candidates_instead_of_materializing_broad_facts() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("conjunction-probe-cost").unwrap();
        let token = |value| Token::new(value).unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..2_000)
                    .map(|n| {
                        let mut document = authoritative_projection(
                            &format!("Thing:{n:05}"),
                            if n < 8 { "selected" } else { "other" },
                        );
                        document.integer_facts.push(predicate_index::IntegerFact {
                            attribute: token("number"),
                            value: n,
                        });
                        ProjectionMutation::Replace(document)
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let query = ValidatedIndexQuery::new(IndexQuery {
            profile: Profile::new(token("profile-v1")),
            partitions: vec![PartitionPredicate {
                partition: token("thing"),
                predicate: PredicateExpr::And(
                    Box::new(PredicateExpr::Exact {
                        attribute: token("owner"),
                        value: ExactValue::utf8("selected").unwrap(),
                    }),
                    Box::new(PredicateExpr::And(
                        Box::new(PredicateExpr::ExactExists {
                            attribute: token("server-relation"),
                        }),
                        Box::new(PredicateExpr::And(
                            Box::new(PredicateExpr::I64Range {
                                attribute: token("number"),
                                lower: Some(RangeBound::Inclusive(0)),
                                upper: None,
                            }),
                            Box::new(PredicateExpr::Not(Box::new(PredicateExpr::Exact {
                                attribute: token("owner"),
                                value: ExactValue::utf8("excluded").unwrap(),
                            }))),
                        )),
                    )),
                ),
            }],
            sort_attribute: token("updated-at"),
            sort_direction: SortDirection::Asc,
            tie_break_direction: SortDirection::Asc,
            limit: 100,
        })
        .unwrap();
        let (sql, parameters) = compile_predicate_selection(&query, &[], true);
        let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
        let actual = driver::query_prepared(&mut statement, parameters)
            .unwrap()
            .iter()
            .map(|row| required_text(row, 0).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            actual,
            (0..8).map(|n| format!("Thing:{n:05}")).collect::<Vec<_>>()
        );
        let steps = statement.metrics().vm_steps;
        assert!(
            steps < 5_000,
            "eight candidates required {steps} VM steps; residual facts must be point probes"
        );
    });
}
