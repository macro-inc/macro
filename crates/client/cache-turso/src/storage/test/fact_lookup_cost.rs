use super::*;
use predicate_index::{ExactValue, IndexQuery, PartitionPredicate};

#[test]
fn fact_joins_use_document_point_lookups_for_both_sources() {
    block_on(async {
        for optimistic in [false, true] {
            let count = 300_u32;
            let mut storage = TursoStorage::open_in_memory("fact-lookup-cost").unwrap();
            let documents = (0..count)
                .map(|n| {
                    let mut document =
                        authoritative_projection(&format!("Thing:{n:05}"), "owner-1");
                    document.integer_facts.push(predicate_index::IntegerFact {
                        attribute: Token::new("number").unwrap(),
                        value: i64::from(n),
                    });
                    document
                })
                .collect::<Vec<_>>();
            if optimistic {
                storage
                    .enqueue_mutation_with_shadow(
                        queued("FactLookupCost"),
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

            for predicate in [
                PredicateExpr::Exact {
                    attribute: Token::new("owner").unwrap(),
                    value: ExactValue::utf8("owner-1").unwrap(),
                },
                PredicateExpr::ExactExists {
                    attribute: Token::new("owner").unwrap(),
                },
                PredicateExpr::I64Range {
                    attribute: Token::new("number").unwrap(),
                    lower: Some(RangeBound::Inclusive(0)),
                    upper: Some(RangeBound::Inclusive(i64::from(count))),
                },
                PredicateExpr::After {
                    attribute: Token::new("updated-at").unwrap(),
                    value: 0,
                    key: PredicateRecordKey::new("Thing:00000").unwrap(),
                    direction: SortDirection::Asc,
                    tie_direction: SortDirection::Asc,
                },
            ] {
                let query = ValidatedIndexQuery::new(IndexQuery {
                    profile: Profile::new(Token::new("profile-v1").unwrap()),
                    partitions: vec![PartitionPredicate {
                        partition: Token::new("thing").unwrap(),
                        predicate: predicate.clone(),
                    }],
                    sort_attribute: Token::new("updated-at").unwrap(),
                    sort_direction: SortDirection::Asc,
                    tie_break_direction: SortDirection::Asc,
                    limit: 100,
                })
                .unwrap();
                let (sql, parameters) = compile_predicate_selection(&query, &[], true);
                let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
                let rows = driver::query_prepared(&mut statement, parameters).unwrap();
                let actual = rows
                    .iter()
                    .map(|row| required_text(row, 0).unwrap())
                    .collect::<Vec<_>>();
                let expected = (0..100)
                    .map(|n| format!("Thing:{n:05}"))
                    .collect::<Vec<_>>();
                assert_eq!(actual, expected);
                let steps = statement.metrics().vm_steps;
                let budget = u64::from(count) * 300;
                assert!(
                    steps < budget,
                    "{predicate:?}, optimistic={optimistic}: {steps} steps exceeds {budget}"
                );
            }
        }
    });
}
