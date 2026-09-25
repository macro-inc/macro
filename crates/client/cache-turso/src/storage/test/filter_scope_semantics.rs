use super::*;
use predicate_index::{ExactValue, IndexQuery, PartitionPredicate, evaluate_reference};

fn query(predicate: PredicateExpr) -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: Profile::new(Token::new("profile-v1").unwrap()),
        partitions: vec![PartitionPredicate {
            partition: Token::new("thing").unwrap(),
            predicate,
        }],
        sort_attribute: Token::new("updated-at").unwrap(),
        sort_direction: SortDirection::Asc,
        tie_break_direction: SortDirection::Asc,
        limit: 100,
    })
    .unwrap()
}

fn owner() -> PredicateExpr {
    PredicateExpr::Exact {
        attribute: Token::new("owner").unwrap(),
        value: ExactValue::utf8("selected").unwrap(),
    }
}

#[test]
fn conjunction_rewrites_match_reference_with_nested_negation_and_missing_facts() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("negated-conjunction-truth").unwrap();
        let mut missing = authoritative_projection("Thing:missing", "selected");
        missing
            .exact_facts
            .retain(|fact| fact.attribute.as_str() != "owner");
        let documents = vec![
            authoritative_projection("Thing:selected", "selected"),
            authoritative_projection("Thing:other", "other"),
            missing,
        ];
        storage
            .put_batch_with_projections(
                Vec::new(),
                documents
                    .iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();
        let terms = [
            PredicateExpr::All,
            PredicateExpr::None,
            owner(),
            PredicateExpr::Not(Box::new(owner())),
            PredicateExpr::Not(Box::new(PredicateExpr::Not(Box::new(owner())))),
            PredicateExpr::ExactExists {
                attribute: Token::new("owner").unwrap(),
            },
            PredicateExpr::Or(Box::new(owner()), Box::new(PredicateExpr::None)),
        ];
        for left in &terms {
            for right in &terms {
                let query = query(PredicateExpr::And(
                    Box::new(left.clone()),
                    Box::new(right.clone()),
                ));
                let expected = evaluate_reference(&query, &documents)
                    .into_iter()
                    .map(|hit| hit.record_key)
                    .collect::<Vec<_>>();
                let actual = storage
                    .reconcile_predicate_index(&query, &[])
                    .await
                    .unwrap();
                assert_eq!(actual.keys, expected, "left={left:?}, right={right:?}");
            }
        }
    });
}

#[test]
fn empty_predicates_accept_excluded_optimistic_ids_without_selecting_rows() {
    let storage = TursoStorage::open_in_memory("empty-filter-exclusions").unwrap();
    let (sql, parameters) = compile_predicate_selection(&query(PredicateExpr::None), &[1, 2], true);
    assert!(
        driver::query(&storage.connection(), &sql, parameters)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn scoped_universe_never_reveals_authority_hidden_by_moved_or_uncertain_shadows() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("scoped-shadow-suppression").unwrap();
        let documents = [
            "kept",
            "profile-moved",
            "partition-moved",
            "deleted",
            "uncertain",
        ]
        .map(|id| authoritative_projection(&format!("Thing:{id}"), "selected"));
        storage
            .put_batch_with_projections(
                Vec::new(),
                documents
                    .iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();
        let mut profile_moved = documents[1].clone();
        profile_moved.profile = Profile::new(Token::new("other-profile").unwrap());
        let mut partition_moved = documents[2].clone();
        partition_moved.partition = Token::new("other-partition").unwrap();
        let complete = |document| PendingOptimisticProjection {
            state: OptimisticProjectionState::Complete(document),
            uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
        };
        storage
            .enqueue_mutation_with_shadow(
                queued("ScopeSuppression"),
                vec![
                    complete(profile_moved),
                    complete(partition_moved),
                    PendingOptimisticProjection {
                        state: OptimisticProjectionState::Deleted {
                            record_key: documents[3].record_key.clone(),
                            profile: documents[3].profile.clone(),
                            partition: documents[3].partition.clone(),
                        },
                        uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                    },
                    PendingOptimisticProjection {
                        state: OptimisticProjectionState::Complete(documents[4].clone()),
                        uncertainty: OptimisticUncertainty::Attributes(
                            [Token::new("owner").unwrap()].into(),
                        ),
                    },
                    complete(authoritative_projection("Thing:created", "selected")),
                ],
            )
            .await
            .unwrap();
        let query = query(PredicateExpr::Not(Box::new(PredicateExpr::Exact {
            attribute: Token::new("owner").unwrap(),
            value: ExactValue::utf8("excluded").unwrap(),
        })));
        let result = storage
            .reconcile_predicate_index(&query, &[])
            .await
            .unwrap();
        assert_eq!(
            result.keys,
            vec![
                PredicateRecordKey::new("Thing:created").unwrap(),
                PredicateRecordKey::new("Thing:kept").unwrap(),
            ]
        );
        assert!(result.optimistic);
    });
}
