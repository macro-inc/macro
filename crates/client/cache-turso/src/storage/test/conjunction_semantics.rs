use super::*;
use predicate_index::{ExactValue, IndexQuery, PartitionPredicate, evaluate_reference};

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}
fn exact(attribute: &str, value: &str) -> PredicateExpr {
    PredicateExpr::Exact {
        attribute: token(attribute),
        value: ExactValue::utf8(value).unwrap(),
    }
}
fn and(left: PredicateExpr, right: PredicateExpr) -> PredicateExpr {
    PredicateExpr::And(Box::new(left), Box::new(right))
}
fn or(left: PredicateExpr, right: PredicateExpr) -> PredicateExpr {
    PredicateExpr::Or(Box::new(left), Box::new(right))
}
fn not(inner: PredicateExpr) -> PredicateExpr {
    PredicateExpr::Not(Box::new(inner))
}

fn documents() -> Vec<predicate_index::IndexDocument> {
    (0..16)
        .map(|n| {
            let mut doc = authoritative_projection(
                &format!("Thing:{n:02}"),
                if n % 2 == 0 { "selected" } else { "other" },
            );
            for (divisor, value) in [(2, "red"), (3, "blue")] {
                if n % divisor == 0 {
                    doc.exact_facts.push(predicate_index::ExactFact {
                        attribute: token("tag"),
                        value: ExactValue::utf8(value).unwrap(),
                    });
                }
            }
            if n % 4 != 0 {
                doc.integer_facts.push(predicate_index::IntegerFact {
                    attribute: token("number"),
                    value: if n == 15 { i64::MAX } else { n - 8 },
                });
            }
            doc.sort_facts = if n == 6 {
                Vec::new()
            } else {
                vec![predicate_index::IntegerFact {
                    attribute: token("updated-at"),
                    value: n / 3,
                }]
            };
            doc
        })
        .collect()
}

fn residuals() -> Vec<PredicateExpr> {
    let range = PredicateExpr::I64Range {
        attribute: token("number"),
        lower: Some(RangeBound::Exclusive(-6)),
        upper: Some(RangeBound::Inclusive(5)),
    };
    let exists = PredicateExpr::ExactExists {
        attribute: token("tag"),
    };
    let mut terms = vec![
        PredicateExpr::All,
        PredicateExpr::None,
        exact("tag", "red"),
        exists.clone(),
        exact("missing", "no"),
        not(exists.clone()),
        not(exact("tag", "red")),
        and(exact("tag", "red"), exact("tag", "blue")),
        or(exact("tag", "red"), exact("tag", "blue")),
        or(exact("tag", "blue"), exact("owner", "other")),
        range.clone(),
        not(range.clone()),
        not(and(exists.clone(), range)),
        not(not(or(exists, exact("missing", "no")))),
        PredicateExpr::I64Range {
            attribute: token("number"),
            lower: None,
            upper: None,
        },
        PredicateExpr::I64Range {
            attribute: token("number"),
            lower: Some(RangeBound::Inclusive(i64::MIN)),
            upper: Some(RangeBound::Inclusive(i64::MAX)),
        },
    ];
    for direction in [SortDirection::Asc, SortDirection::Desc] {
        for tie_direction in [SortDirection::Asc, SortDirection::Desc] {
            terms.push(PredicateExpr::After {
                attribute: token("updated-at"),
                value: 2,
                key: PredicateRecordKey::new("Thing:07").unwrap(),
                direction,
                tie_direction,
            });
        }
    }
    terms
}

#[test]
fn fused_conjunctions_match_reference_across_sources_scopes_missing_facts_and_keysets() {
    block_on(async {
        for optimistic in [false, true] {
            let mut storage = TursoStorage::open_in_memory("conjunction-reference").unwrap();
            let docs = documents();
            let mut outside_profile = docs[0].clone();
            outside_profile.record_key = PredicateRecordKey::new("Outside:profile").unwrap();
            outside_profile.profile = Profile::new(token("other-profile"));
            let mut outside_partition = docs[0].clone();
            outside_partition.record_key = PredicateRecordKey::new("Outside:partition").unwrap();
            outside_partition.partition = token("other-partition");
            let all = [docs.clone(), vec![outside_profile, outside_partition]].concat();
            let mut effective = all.clone();
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    all.iter()
                        .cloned()
                        .map(ProjectionMutation::Replace)
                        .collect(),
                )
                .await
                .unwrap();
            if optimistic {
                let mut shadows = Vec::new();
                for n in [1_usize, 2, 3, 4, 5, 8] {
                    effective.retain(|doc| doc.record_key != docs[n].record_key);
                    let mut changed = docs[n].clone();
                    changed
                        .exact_facts
                        .retain(|fact| fact.attribute.as_str() != "owner");
                    changed.exact_facts.push(predicate_index::ExactFact {
                        attribute: token("owner"),
                        value: ExactValue::utf8("selected").unwrap(),
                    });
                    if n == 2 {
                        changed.partition = token("other-partition");
                    }
                    if n == 3 {
                        changed.profile = Profile::new(token("other-profile"));
                    }
                    let state = if n == 4 {
                        OptimisticProjectionState::Deleted {
                            record_key: changed.record_key.clone(),
                            profile: changed.profile.clone(),
                            partition: changed.partition.clone(),
                        }
                    } else {
                        OptimisticProjectionState::Complete(changed.clone())
                    };
                    let uncertainty = if n == 8 {
                        OptimisticUncertainty::Attributes([token("owner")].into())
                    } else {
                        OptimisticUncertainty::Attributes(BTreeSet::new())
                    };
                    if n != 4 && n != 8 {
                        effective.push(changed);
                    }
                    shadows.push(PendingOptimisticProjection { state, uncertainty });
                }
                let mut created = docs[0].clone();
                created.record_key = PredicateRecordKey::new("Thing:created").unwrap();
                effective.push(created.clone());
                shadows.push(PendingOptimisticProjection {
                    state: OptimisticProjectionState::Complete(created),
                    uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
                });
                storage
                    .enqueue_mutation_with_shadow(queued("ConjunctionShadow"), shadows)
                    .await
                    .unwrap();
            }
            for residual in residuals() {
                for commuted in [false, true] {
                    for direction in [SortDirection::Asc, SortDirection::Desc] {
                        for tie_direction in [SortDirection::Asc, SortDirection::Desc] {
                            let seed = exact("owner", "selected");
                            let predicate = if commuted {
                                and(residual.clone(), seed)
                            } else {
                                and(seed, residual.clone())
                            };
                            let query = ValidatedIndexQuery::new(IndexQuery {
                                profile: Profile::new(token("profile-v1")),
                                partitions: vec![PartitionPredicate {
                                    partition: token("thing"),
                                    predicate,
                                }],
                                sort_attribute: token("updated-at"),
                                sort_direction: direction,
                                tie_break_direction: tie_direction,
                                limit: 7,
                            })
                            .unwrap();
                            let expected = evaluate_reference(&query, &effective)
                                .into_iter()
                                .map(|hit| hit.record_key)
                                .collect::<Vec<_>>();
                            let actual = storage.reconcile_predicate_index(&query, &[]).await.unwrap_or_else(|error| panic!("{error:?}; {residual:?}; optimistic={optimistic}, commuted={commuted}, order={direction:?}/{tie_direction:?}"));
                            assert_eq!(
                                actual.keys, expected,
                                "{residual:?}; optimistic={optimistic}, commuted={commuted}, order={direction:?}/{tie_direction:?}"
                            );
                        }
                    }
                }
            }
        }
    });
}
